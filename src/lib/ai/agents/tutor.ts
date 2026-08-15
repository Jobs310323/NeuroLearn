import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { streamText, stepCountIs, tool, type ModelMessage } from 'ai';
import { z } from 'zod';

import { db } from '@/lib/db';
import { contentBlocks, knowledgeNodes, learningPaths, tutorConversations, tutorMessages } from '@/lib/db/schema';

import { readContext, renderContextForPrompt, writeContext } from '../context';
import { TUTOR_PROMPT } from '../prompts';
import { modelFor } from '../provider';
import { toolInputSchema } from './tool-schema';

/**
 * Tutor: сократический диалог.
 *
 * Единственный канал содержательного ответа — инструмент `socraticMethod`.
 * Это не стилистическое пожелание, а структурная гарантия: модель физически
 * не отдаёт готовое решение обычным текстом, потому что `toolChoice` требует
 * вызова инструмента.
 *
 * Аварийный выход: `scaffoldLevel: 3` (разбор с пошаговым выводом) разрешён
 * только после трёх безуспешных циклов — иначе застрявший человек перестаёт
 * пробовать. Проверка выполняется на сервере, а не доверяется модели.
 */

export const SCAFFOLD_UNLOCK_DEPTH = 3;

export type TutorTurnContext = {
  userId: string;
  conversationId: string;
  nodeId: string | null;
  socraticDepth: number;
};

function socraticTool(context: TutorTurnContext) {
  return tool({
    description:
      'Задать один наводящий вопрос. Единственный способ ответить пользователю по существу.',
    inputSchema: toolInputSchema(
      z.object({
        question: z
          .string()
          .min(5)
          .max(600)
          .describe('Один вопрос, направленный на конкретное место сбоя в рассуждении'),
        scaffoldLevel: z
          .number()
          .int()
          .min(1)
          .max(3)
          .describe('1 — общий вопрос, 2 — сужающий, 3 — разбор (только после трёх циклов)'),
        targetMisconception: z.string().max(300).optional(),
        walkthrough: z
          .string()
          .max(2000)
          .optional()
          .describe('Пошаговый разбор. Допустим только при scaffoldLevel = 3'),
      }),
    ),
    execute: async (input) => {
      const wantsWalkthrough = input.scaffoldLevel === 3 || Boolean(input.walkthrough);
      const unlocked = context.socraticDepth >= SCAFFOLD_UNLOCK_DEPTH;

      if (wantsWalkthrough && !unlocked) {
        return {
          accepted: false,
          reason: `Разбор пока закрыт: сделано ${context.socraticDepth} из ${SCAFFOLD_UNLOCK_DEPTH} циклов. Задай наводящий вопрос уровня 1 или 2.`,
        };
      }

      return {
        accepted: true,
        question: input.question,
        scaffoldLevel: input.scaffoldLevel,
        ...(wantsWalkthrough && unlocked ? { walkthrough: input.walkthrough } : {}),
      };
    },
  });
}

function logGapTool(context: TutorTurnContext) {
  return tool({
    description:
      'Зафиксировать устойчивый пробел или заблуждение ученика. Пользователю об этом не сообщается.',
    inputSchema: toolInputSchema(
      z.object({
        gap: z.string().min(5).max(300),
        misconception: z.string().max(300).optional(),
      }),
    ),
    execute: async (input) => {
      // Для узловой области нужен pathId — достаём его один раз.
      let target: Parameters<typeof writeContext>[2] = { scope: 'global' };
      if (context.nodeId) {
        const node = await db.query.knowledgeNodes.findFirst({
          where: eq(knowledgeNodes.id, context.nodeId),
          columns: { pathId: true },
        });
        if (node) target = { scope: 'node', nodeId: context.nodeId, pathId: node.pathId };
      }

      const current = await readContext(context.userId, 'tutor', target);
      const gaps = [...new Set([...current.facts.gaps, input.gap])].slice(-12);
      const misconceptions = input.misconception
        ? [
            ...current.facts.misconceptions,
            { statement: input.misconception, evidenceResponseIds: [] },
          ].slice(-8)
        : current.facts.misconceptions;

      await writeContext(context.userId, 'tutor', target, {
        summary: current.summary,
        facts: { ...current.facts, gaps, misconceptions },
      });

      return { logged: true };
    },
  });
}

/** Собирает системный промпт: узел, его материал, срез контекста, память диалога. */
export async function buildTutorSystemPrompt(params: {
  userId: string;
  nodeId: string | null;
  memorySummary: string;
}): Promise<string> {
  const parts = [TUTOR_PROMPT];

  if (params.nodeId) {
    const node = await db
      .select({
        title: knowledgeNodes.title,
        description: knowledgeNodes.description,
        pathGoal: learningPaths.goal,
        pathId: knowledgeNodes.pathId,
      })
      .from(knowledgeNodes)
      .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
      .where(eq(knowledgeNodes.id, params.nodeId))
      .limit(1);

    const found = node[0];
    if (found) {
      parts.push(
        `\nТема разговора — узел «${found.title}».` +
          (found.description ? ` Описание: ${found.description}` : '') +
          `\nЦель пути: ${found.pathGoal}`,
      );

      const concept = await db.query.contentBlocks.findFirst({
        where: and(eq(contentBlocks.nodeId, params.nodeId), eq(contentBlocks.type, 'concept')),
        columns: { payload: true },
      });
      if (concept && concept.payload.kind === 'prose') {
        parts.push(`\nМатериал узла (для сверки, не пересказывай его целиком):\n${concept.payload.markdown.slice(0, 2000)}`);
      }

      const analyzer = await readContext(params.userId, 'progress_analyzer', {
        scope: 'node',
        nodeId: params.nodeId,
        pathId: found.pathId,
      });
      parts.push(`\n${renderContextForPrompt(analyzer)}`);
    }
  }

  if (params.memorySummary) {
    parts.push(`\nЧто уже обсуждалось ранее: ${params.memorySummary}`);
  }

  return parts.join('\n');
}

/** Создаёт диалог при первом сообщении. */
export async function ensureConversation(params: {
  userId: string;
  conversationId?: string;
  nodeId: string | null;
}): Promise<{ id: string; memorySummary: string; socraticDepth: number }> {
  if (params.conversationId) {
    const existing = await db.query.tutorConversations.findFirst({
      where: and(
        eq(tutorConversations.id, params.conversationId),
        eq(tutorConversations.userId, params.userId),
      ),
    });
    if (existing) {
      const last = await db.query.tutorMessages.findFirst({
        where: eq(tutorMessages.conversationId, existing.id),
        orderBy: [desc(tutorMessages.createdAt)],
        columns: { socraticDepth: true },
      });
      return {
        id: existing.id,
        memorySummary: existing.memorySummary,
        socraticDepth: last?.socraticDepth ?? 0,
      };
    }
  }

  let pathId: string | null = null;
  if (params.nodeId) {
    const node = await db.query.knowledgeNodes.findFirst({
      where: eq(knowledgeNodes.id, params.nodeId),
      columns: { pathId: true },
    });
    pathId = node?.pathId ?? null;
  }

  const [created] = await db
    .insert(tutorConversations)
    .values({
      id: params.conversationId ?? crypto.randomUUID(),
      userId: params.userId,
      nodeId: params.nodeId,
      pathId,
      title: 'Разбор',
    })
    .returning({ id: tutorConversations.id });

  if (!created) throw new Error('Не удалось создать диалог.');
  return { id: created.id, memorySummary: '', socraticDepth: 0 };
}

export async function loadHistory(conversationId: string, limit = 20): Promise<ModelMessage[]> {
  const rows = await db
    .select({ role: tutorMessages.role, content: tutorMessages.content })
    .from(tutorMessages)
    .where(eq(tutorMessages.conversationId, conversationId))
    .orderBy(asc(tutorMessages.createdAt))
    .limit(limit);

  return rows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content }));
}

export async function persistTurn(params: {
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  socraticDepth: number;
}): Promise<void> {
  await db.batch([
    db.insert(tutorMessages).values({
      conversationId: params.conversationId,
      role: 'user',
      content: params.userMessage,
      socraticDepth: params.socraticDepth,
    }),
    db.insert(tutorMessages).values({
      conversationId: params.conversationId,
      role: 'assistant',
      content: params.assistantMessage,
      socraticDepth: params.socraticDepth + 1,
    }),
    db
      .update(tutorConversations)
      .set({
        messageCount: sql`${tutorConversations.messageCount} + 2`,
        updatedAt: new Date(),
      })
      .where(eq(tutorConversations.id, params.conversationId)),
  ]);
}

/** Запускает стриминг ответа тьютора. */
export function streamTutorReply(params: {
  system: string;
  messages: ModelMessage[];
  context: TutorTurnContext;
}) {
  return streamText({
    model: modelFor('tutor'),
    system: params.system,
    messages: params.messages,
    tools: {
      socraticMethod: socraticTool(params.context),
      logGap: logGapTool(params.context),
    },
    // Инструмент обязателен: прямой текстовый ответ не допускается.
    toolChoice: 'required',
    stopWhen: stepCountIs(3),
    temperature: 0.6,
    maxOutputTokens: 1200,
  });
}
