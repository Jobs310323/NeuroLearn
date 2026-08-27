import { z } from 'zod';

/** Валидация контракта практики/повторений — `docs/API.md` §3–4. */

export const practiceModeSchema = z.enum([
  'pre_assessment',
  'focused',
  'interleaved',
  'review',
  'exam',
  'remediation',
]);

export const practiceNextQuerySchema = z.object({
  nodeId: z.uuid(),
  mix: z.coerce.boolean().optional().default(false),
  /**
   * Без явного значения решает `decidePolicy` (`services/practice/policy.ts`)
   * по темпу пользователя и желаемой длине сессии — поэтому default здесь
   * не ставится: он неотличим был бы от явного выбора клиента.
   */
  limit: z.coerce.number().int().min(1).max(30).optional(),
  mode: practiceModeSchema.optional().default('focused'),
  interleaveRatio: z.coerce.number().min(0).max(0.6).optional(),
});

export const startSessionSchema = z.object({
  sessionDraftId: z.string().min(1),
});

const userResponsePayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('option_ids'), ids: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('text'), value: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal('blanks'), byBlankId: z.record(z.string(), z.string()) }),
  z.object({ kind: z.literal('order'), ids: z.array(z.string()) }),
  z.object({ kind: z.literal('pairs'), byLeftId: z.record(z.string(), z.string()) }),
  z.object({ kind: z.literal('numeric'), value: z.number() }),
  z.object({ kind: z.literal('code'), source: z.string().max(20000) }),
]);

export const submitResponseSchema = z.object({
  assessmentId: z.uuid(),
  response: userResponsePayloadSchema,
  /** Только время до фиксации ответа; шкала уверенности сюда не входит. */
  responseTimeMs: z.number().int().min(0).max(10 * 60 * 1000),
  confidenceLevel: z.number().int().min(1).max(5).optional(),
  confidenceLatencyMs: z.number().int().min(0).max(10 * 60 * 1000).optional(),
  /**
   * 1..5, Judgment of Knowing — собирается ДО попытки ответить, в момент
   * показа задания. Отличается от `confidenceLevel` направлением: JOK
   * предсказывает исход, `confidenceLevel` оценивает уже данный ответ.
   */
  jokLevel: z.number().int().min(1).max(5).optional(),
  hintsUsed: z.number().int().min(0).max(20).optional(),
  /**
   * Была ли попытка вспомнить до того, как открыли подсказку (PRD §3 п.4,
   * эффект генерации). По умолчанию `true`: в обычной практике подсказок до
   * ответа нет вовсе, а `guided_practice` с затухающими подсказками, ради
   * которой поле и заведено, отправит `false` явно.
   */
  retrievalAttempted: z.boolean().optional(),
});

export const reviewQueueQuerySchema = z.object({
  pathId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  horizon: z.enum(['today', 'week']).optional().default('today'),
});

export const gradeCardSchema = z.object({
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  sessionId: z.uuid().optional(),
  reviewedAt: z.iso.datetime().optional(),
});
