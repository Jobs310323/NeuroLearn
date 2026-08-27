import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  assessments,
  knowledgeNodes,
  responseDiagnoses,
  userResponses,
} from '@/lib/db/schema';

import { generateValidated } from '../generate';
import { ERROR_CLASSIFIER_PROMPT } from '../prompts';
import { errorDiagnosisSchema } from '../schemas';

/**
 * Разбор ошибок: чем именно был неверен ответ.
 *
 * Работает пакетом после сессии, а не в реальном времени, и это не оптимизация.
 * Тип ошибки нельзя определить по одному ответу: `transfer_failure` виден
 * только на фоне верных ответов по той же теме, `careless` — только на фоне
 * обычного времени ответа этого человека. Пакет даёт классификатору тот
 * контекст, которого у отдельного ответа нет.
 *
 * Различение нужно ради выбора следующего шага (PRD §3 п.7 и п.9):
 * концептуальная ошибка лечится контрастными случаями, провал переноса —
 * разобранным примером в новом контексте, невнимательность — не лечится
 * материалом вообще.
 */

/** Больше за раз не берём: промпт должен остаться обозримым для дешёвой модели. */
const MAX_BATCH = 12;

/**
 * Ответ считается быстрым, если он заметно быстрее обычного для этого
 * человека. Признак нужен модели, чтобы отличать `careless` от остальных:
 * невнимательность — это быстро и уверенно, а не медленно и мучительно.
 */
const FAST_RATIO = 0.6;

/**
 * F9: сначала правила, LLM — только для двух классов, которые правилами не
 * различить.
 *
 * `careless` и `transfer_failure` телеметрически определены: careless — это
 * быстро, уверенно и на фоне уже освоенного узла (то же условие, что модель
 * применяла раньше через текстовый промпт, — здесь оно точное правило, а не
 * догадка модели). transfer_failure — верные ответы по узлу есть, но не в
 * этом контексте (`contextLabel`). `factual_slip` и `conceptual` остаются
 * за LLM: различить «промах в факте» от «неверная модель» без понимания
 * содержания ответа нельзя, для этого и нужна семантика модели.
 *
 * Экономия не побочный эффект: если ВСЕ неверные ответы сессии разрешились
 * правилами, вызов модели не делается вовсе.
 */
const CARELESS_MIN_PRIOR_CORRECT = 3;
const CARELESS_MIN_CONFIDENCE = 4;

type RuleDiagnosis = { kind: 'careless' | 'transfer_failure'; evidence: string; confidence: number };

function ruleClassify(
  candidate: Candidate,
  fastMs: number | null,
  correctCount: number,
  correctContexts: Set<string>,
): RuleDiagnosis | null {
  const isFast = fastMs !== null && candidate.responseTimeMs < fastMs;
  const isConfident = candidate.confidenceLevel !== null && candidate.confidenceLevel >= CARELESS_MIN_CONFIDENCE;
  if (isFast && isConfident && correctCount >= CARELESS_MIN_PRIOR_CORRECT) {
    return {
      kind: 'careless',
      evidence: `Ответ за ${candidate.responseTimeMs}мс — быстрее обычного для этого ученика — при заявленной уверенности ${candidate.confidenceLevel}/5 и ${correctCount} верных ответах по узлу ранее.`,
      confidence: 0.75,
    };
  }

  const hasContext = candidate.contextLabel !== null;
  const seenThisContext = hasContext && correctContexts.has(candidate.contextLabel as string);
  if (correctCount >= 1 && hasContext && correctContexts.size > 0 && !seenThisContext) {
    return {
      kind: 'transfer_failure',
      evidence: `${correctCount} верных ответов по узлу в контекстах (${[...correctContexts].join(', ')}), но не в контексте «${candidate.contextLabel}».`,
      confidence: 0.7,
    };
  }

  return null;
}

type Candidate = {
  id: string;
  nodeId: string;
  nodeTitle: string;
  prompt: string;
  responseText: string;
  responseTimeMs: number;
  confidenceLevel: number | null;
  cognitiveLevel: string;
  contextLabel: string | null;
};

/** Ответ пользователя в читаемом для модели виде. Правильный ответ не передаётся. */
function describeResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '(пусто)';
  const value = payload as Record<string, unknown>;

  if (value.kind === 'text' && typeof value.value === 'string') return value.value.slice(0, 500);
  if (value.kind === 'option_ids' && Array.isArray(value.ids)) return `выбраны варианты: ${value.ids.join(', ')}`;
  if (value.kind === 'numeric') return `число: ${String(value.value)}`;
  if (value.kind === 'blanks' && value.byBlankId && typeof value.byBlankId === 'object') {
    return Object.entries(value.byBlankId as Record<string, string>)
      .map(([key, text]) => `${key}: ${text}`)
      .join('; ')
      .slice(0, 500);
  }
  if (value.kind === 'order' && Array.isArray(value.ids)) return `порядок: ${value.ids.join(' → ')}`;
  return JSON.stringify(value).slice(0, 300);
}

/**
 * Неверные ответы сессии, которые ещё не разобраны.
 *
 * `leftJoin ... isNull` вместо `not in (select ...)`: повторный вызов на той
 * же сессии не должен присылать модели то, что уже разобрано, — уникальный
 * индекс по `response_id` это и так не пропустит, но платить за вызов
 * впустую незачем.
 */
async function pendingResponses(userId: string, sessionId: string): Promise<Candidate[]> {
  const rows = await db
    .select({
      id: userResponses.id,
      nodeId: userResponses.nodeId,
      nodeTitle: knowledgeNodes.title,
      prompt: assessments.prompt,
      response: userResponses.response,
      responseTimeMs: userResponses.responseTimeMs,
      confidenceLevel: userResponses.confidenceLevel,
      cognitiveLevel: assessments.cognitiveLevel,
      contextLabel: assessments.contextLabel,
    })
    .from(userResponses)
    .innerJoin(assessments, eq(assessments.id, userResponses.assessmentId))
    .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, userResponses.nodeId))
    .leftJoin(responseDiagnoses, eq(responseDiagnoses.responseId, userResponses.id))
    .where(
      and(
        eq(userResponses.userId, userId),
        eq(userResponses.sessionId, sessionId),
        eq(userResponses.isCorrect, false),
        isNull(responseDiagnoses.id),
      ),
    )
    .limit(MAX_BATCH);

  return rows.map((row) => ({
    id: row.id,
    nodeId: row.nodeId,
    nodeTitle: row.nodeTitle,
    prompt: row.prompt,
    responseText: describeResponse(row.response),
    responseTimeMs: row.responseTimeMs,
    confidenceLevel: row.confidenceLevel,
    cognitiveLevel: row.cognitiveLevel,
    contextLabel: row.contextLabel,
  }));
}

/** Медиана времени верных ответов — база для признака «быстро». */
async function fastThresholdMs(userId: string): Promise<number | null> {
  const rows = await db
    .select({ responseTimeMs: userResponses.responseTimeMs })
    .from(userResponses)
    .where(and(eq(userResponses.userId, userId), eq(userResponses.isCorrect, true)))
    .orderBy(desc(userResponses.createdAt))
    .limit(200);

  if (rows.length < 10) return null;
  const sorted = rows.map((r) => r.responseTimeMs).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
      : (sorted[middle] as number);
  return median * FAST_RATIO;
}

/**
 * Сколько верных ответов у человека по этому узлу. Нужно, чтобы отличить
 * провал переноса (тема освоена, контекст новый) от простого незнания.
 */
async function correctCountsByNode(userId: string, nodeIds: string[]): Promise<Map<string, number>> {
  if (nodeIds.length === 0) return new Map();

  const rows = await db
    .select({ nodeId: userResponses.nodeId })
    .from(userResponses)
    .where(
      and(
        eq(userResponses.userId, userId),
        eq(userResponses.isCorrect, true),
        inArray(userResponses.nodeId, nodeIds),
      ),
    );

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.nodeId, (counts.get(row.nodeId) ?? 0) + 1);
  return counts;
}

/** Контексты, в которых человек уже отвечал верно по узлу — вход для правила `transfer_failure`. */
async function correctContextsByNode(userId: string, nodeIds: string[]): Promise<Map<string, Set<string>>> {
  if (nodeIds.length === 0) return new Map();

  const rows = await db
    .select({ nodeId: userResponses.nodeId, contextLabel: assessments.contextLabel })
    .from(userResponses)
    .innerJoin(assessments, eq(assessments.id, userResponses.assessmentId))
    .where(
      and(
        eq(userResponses.userId, userId),
        eq(userResponses.isCorrect, true),
        inArray(userResponses.nodeId, nodeIds),
      ),
    );

  const byNode = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.contextLabel) continue;
    const set = byNode.get(row.nodeId) ?? new Set<string>();
    set.add(row.contextLabel);
    byNode.set(row.nodeId, set);
  }
  return byNode;
}

function buildPrompt(
  candidates: Candidate[],
  correctByNode: Map<string, number>,
  fastMs: number | null,
): string {
  const lines = candidates.map((candidate, index) => {
    const flags: string[] = [];
    if (fastMs !== null && candidate.responseTimeMs < fastMs) flags.push('ответ быстрый для этого ученика');
    if (candidate.confidenceLevel !== null) flags.push(`уверенность ${candidate.confidenceLevel} из 5`);
    const correct = correctByNode.get(candidate.nodeId) ?? 0;
    flags.push(`верных ответов по узлу ранее: ${correct}`);
    if (candidate.contextLabel) flags.push(`контекст задания: ${candidate.contextLabel}`);

    return [
      `[${index}] узел «${candidate.nodeTitle}», уровень ${candidate.cognitiveLevel}`,
      `  Задание: ${candidate.prompt.slice(0, 400)}`,
      `  Ответ ученика: ${candidate.responseText}`,
      `  Признаки: ${flags.join('; ')}`,
    ].join('\n');
  });

  return [
    fastMs === null
      ? 'Данных о обычном темпе ученика пока мало — признак «быстрый ответ» не используется.'
      : `Обычный ответ этого ученика заметно медленнее ${Math.round(fastMs)} мс.`,
    '',
    'Неверные ответы:',
    ...lines,
  ].join('\n');
}

export async function classifySessionErrors(params: {
  userId: string;
  sessionId: string;
  budgetMs?: number;
}): Promise<{ skipped: true } | { skipped: false; saved: number }> {
  const candidates = await pendingResponses(params.userId, params.sessionId);
  // Ошибок нет — разбирать нечего, и вызов модели не делается вовсе.
  if (candidates.length === 0) return { skipped: true };

  const nodeIds = [...new Set(candidates.map((c) => c.nodeId))];
  const [fastMs, correctByNode, correctContextsByNodeMap] = await Promise.all([
    fastThresholdMs(params.userId),
    correctCountsByNode(params.userId, nodeIds),
    correctContextsByNode(params.userId, nodeIds),
  ]);

  // Правила решают то, что телеметрически определено (см. комментарий у
  // `ruleClassify`), не тратя вызов модели. Остальное идёт в LLM.
  type Row = {
    responseId: string;
    userId: string;
    nodeId: string;
    kind: 'factual_slip' | 'conceptual' | 'transfer_failure' | 'careless';
    misconception: string | null;
    evidence: string;
    confidence: number;
    generatedBy: string | null;
  };
  const rows: Row[] = [];
  const llmCandidates: Candidate[] = [];

  for (const candidate of candidates) {
    const ruled = ruleClassify(
      candidate,
      fastMs,
      correctByNode.get(candidate.nodeId) ?? 0,
      correctContextsByNodeMap.get(candidate.nodeId) ?? new Set(),
    );
    if (ruled) {
      rows.push({
        responseId: candidate.id,
        userId: params.userId,
        nodeId: candidate.nodeId,
        kind: ruled.kind,
        misconception: null,
        evidence: ruled.evidence,
        confidence: ruled.confidence,
        generatedBy: 'rule:v1',
      });
    } else {
      llmCandidates.push(candidate);
    }
  }

  if (llmCandidates.length > 0) {
    const { data, generationId } = await generateValidated({
      agent: 'metacognitive_coach',
      operation: 'classify_errors',
      userId: params.userId,
      system: ERROR_CLASSIFIER_PROMPT,
      prompt: buildPrompt(llmCandidates, correctByNode, fastMs),
      schema: errorDiagnosisSchema,
      targetTable: 'response_diagnoses',
      targetId: params.sessionId,
      maxOutputTokens: 2500,
      retryBudgetMs: params.budgetMs,
    });

    for (const diagnosis of data.diagnoses) {
      // Индекс вне списка — модель сослалась на несуществующий ответ.
      // Записывать такое нельзя: разбор привязался бы не к тому ответу.
      if (diagnosis.index < 0 || diagnosis.index >= llmCandidates.length) continue;
      const candidate = llmCandidates[diagnosis.index]!;
      rows.push({
        responseId: candidate.id,
        userId: params.userId,
        nodeId: candidate.nodeId,
        kind: diagnosis.kind,
        // Заблуждение осмысленно только для концептуальной ошибки;
        // для остальных модель просит не заполнять, но проверяем и здесь.
        misconception: diagnosis.kind === 'conceptual' ? (diagnosis.misconception ?? null) : null,
        evidence: diagnosis.evidence,
        confidence: diagnosis.confidence,
        generatedBy: generationId,
      });
    }
  }

  if (rows.length === 0) return { skipped: false, saved: 0 };

  await db
    .insert(responseDiagnoses)
    .values(rows)
    // Повторный разбор того же ответа заменяет прежний: мнение о нём одно,
    // а история мнений здесь никому не нужна.
    .onConflictDoUpdate({
      target: responseDiagnoses.responseId,
      set: {
        kind: sql`excluded.kind`,
        misconception: sql`excluded.misconception`,
        evidence: sql`excluded.evidence`,
        confidence: sql`excluded.confidence`,
        generatedBy: sql`excluded.generated_by`,
      },
    });

  return { skipped: false, saved: rows.length };
}

/**
 * Сводка типов ошибок по узлу — вход для выбора материала.
 * Разборы с низкой уверенностью классификатора отбрасываются: неуверенный
 * разбор хуже отсутствия разбора, потому что молча уводит подбор не туда.
 */
export async function errorProfileForNode(
  userId: string,
  nodeId: string,
  minConfidence = 0.5,
): Promise<{ kind: string; count: number; misconceptions: string[] }[]> {
  const rows = await db
    .select({
      kind: responseDiagnoses.kind,
      misconception: responseDiagnoses.misconception,
    })
    .from(responseDiagnoses)
    .where(
      and(
        eq(responseDiagnoses.userId, userId),
        eq(responseDiagnoses.nodeId, nodeId),
        gte(responseDiagnoses.confidence, minConfidence),
      ),
    );

  const grouped = new Map<string, { count: number; misconceptions: Set<string> }>();
  for (const row of rows) {
    const entry = grouped.get(row.kind) ?? { count: 0, misconceptions: new Set<string>() };
    entry.count += 1;
    if (row.misconception) entry.misconceptions.add(row.misconception);
    grouped.set(row.kind, entry);
  }

  return [...grouped.entries()]
    .map(([kind, entry]) => ({
      kind,
      count: entry.count,
      misconceptions: [...entry.misconceptions],
    }))
    .sort((a, b) => b.count - a.count);
}
