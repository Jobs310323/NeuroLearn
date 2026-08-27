import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import { userContext } from '@/lib/db/schema';
import type { AgentFacts } from '@/lib/db/schema/types';

import type { AgentKind } from './provider';

/**
 * Общая «доска» агентов.
 *
 * Агенты не вызывают друг друга: ProgressAnalyzer пишет свой срез, Tutor и
 * MetacognitiveCoach читают его при сборке промпта. Слот определяется парой
 * (агент, область) — по одной записи на пользователя, путь и узел.
 */

export type ContextScope =
  | { scope: 'global' }
  | { scope: 'path'; pathId: string }
  | { scope: 'node'; nodeId: string; pathId: string };

const EMPTY_FACTS: AgentFacts = {
  strengths: [],
  gaps: [],
  misconceptions: [],
  recommendedFocusNodeIds: [],
  notes: '',
};

function scopeConditions(userId: string, agent: AgentKind, target: ContextScope) {
  const base = [eq(userContext.userId, userId), eq(userContext.agent, agent)];

  if (target.scope === 'global') {
    return and(...base, eq(userContext.scope, 'global'), isNull(userContext.nodeId));
  }
  if (target.scope === 'path') {
    return and(
      ...base,
      eq(userContext.scope, 'path'),
      eq(userContext.pathId, target.pathId),
      isNull(userContext.nodeId),
    );
  }
  return and(...base, eq(userContext.scope, 'node'), eq(userContext.nodeId, target.nodeId));
}

export async function readContext(
  userId: string,
  agent: AgentKind,
  target: ContextScope,
): Promise<{ summary: string; facts: AgentFacts }> {
  const row = await db.query.userContext.findFirst({
    where: scopeConditions(userId, agent, target),
  });
  return row ? { summary: row.summary, facts: row.facts } : { summary: '', facts: EMPTY_FACTS };
}

/**
 * Записывает срез агента с оптимистической блокировкой по `version`
 * (PRD §7). Колонка была объявлена с самого начала, но не проверялась:
 * запись шла безусловным `onConflictDoUpdate`, и одновременные записи двух
 * агентов в один слот молча перетирали друг друга — терялся тот срез, что
 * записался первым.
 *
 * Возвращает `false`, если слот успели изменить между чтением и записью.
 * Это не ошибка: срез агента — производная от телеметрии, его можно
 * пересчитать. Ронять фоновую задачу из-за гонки хуже, чем пропустить одну
 * запись.
 */
export async function writeContext(
  userId: string,
  agent: AgentKind,
  target: ContextScope,
  value: { summary: string; facts: AgentFacts },
): Promise<boolean> {
  const pathId = target.scope === 'global' ? null : target.pathId;
  const nodeId = target.scope === 'node' ? target.nodeId : null;

  const current = await db.query.userContext.findFirst({
    where: scopeConditions(userId, agent, target),
    columns: { id: true, version: true },
  });

  if (!current) {
    // Слота ещё нет. `onConflictDoNothing` закрывает гонку двух вставок:
    // проигравшая ничего не пишет и получает `false`, как при любом другом
    // проигрыше в состязании за слот.
    const inserted = await db
      .insert(userContext)
      .values({
        userId,
        agent,
        scope: target.scope,
        pathId,
        nodeId,
        summary: value.summary,
        facts: value.facts,
      })
      .onConflictDoNothing({
        target: [
          userContext.userId,
          userContext.agent,
          userContext.scope,
          userContext.pathId,
          userContext.nodeId,
        ],
      })
      .returning({ id: userContext.id });

    return inserted.length > 0;
  }

  const updated = await db
    .update(userContext)
    .set({
      summary: value.summary,
      facts: value.facts,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    // Условие по `version` и есть блокировка: если между чтением и этим
    // запросом слот изменился, ни одна строка не подойдёт и запись не пройдёт.
    .where(and(eq(userContext.id, current.id), eq(userContext.version, current.version)))
    .returning({ id: userContext.id });

  return updated.length > 0;
}

/**
 * Срез контекста для вставки в системный промпт.
 * Бюджет — около 800 токенов, поэтому списки обрезаются.
 */
export function renderContextForPrompt(context: {
  summary: string;
  facts: AgentFacts;
}): string {
  const parts: string[] = [];

  if (context.summary) parts.push(`Сводка по ученику: ${context.summary}`);
  if (context.facts.gaps.length > 0) {
    parts.push(`Известные пробелы: ${context.facts.gaps.slice(0, 6).join('; ')}`);
  }
  if (context.facts.misconceptions.length > 0) {
    parts.push(
      `Заблуждения: ${context.facts.misconceptions
        .slice(0, 4)
        .map((m) => m.statement)
        .join('; ')}`,
    );
  }
  if (context.facts.strengths.length > 0) {
    parts.push(`Сильные стороны: ${context.facts.strengths.slice(0, 5).join('; ')}`);
  }

  return parts.length > 0 ? parts.join('\n') : 'Данных о прошлой практике пока нет.';
}
