import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { apiError, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import {
  assessments,
  knowledgeNodes,
  learningPaths,
  nodeProgress,
  practiceSessions,
  userResponses,
} from '@/lib/db/schema';
import { UTF8_BOM, toCsv, type CsvValue } from '@/lib/services/analytics/csv';

/**
 * Режим «эксперт»: выгрузка сырых данных в CSV.
 *
 * Смысл не в удобстве, а в проверяемости. Приложение утверждает вещи о вашем
 * обучении — «прочность 72», «переоценка себя», «интерливинг работает». Все
 * они выведены из этих строк, и человек должен иметь возможность пересчитать
 * их сам, а не верить на слово.
 *
 * Три набора вместо одного: ответы, узлы, сессии. Одна широкая таблица со
 * всеми join-ами была бы удобнее для беглого взгляда и бесполезна для
 * пересчёта — в ней каждая величина размазана по повторяющимся строкам.
 */
const querySchema = z.object({
  dataset: z.enum(['responses', 'nodes', 'sessions']).default('responses'),
  pathId: z.uuid().optional(),
});

export async function GET(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return validationFailed(parsed.error);

  const { dataset, pathId } = parsed.data;

  if (pathId) {
    const owned = await db.query.learningPaths.findFirst({
      where: and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)),
      columns: { id: true },
    });
    if (!owned) return apiError('NOT_FOUND', 'Путь не найден.');
  }

  const nodeIds = pathId
    ? (
        await db
          .select({ id: knowledgeNodes.id })
          .from(knowledgeNodes)
          .where(eq(knowledgeNodes.pathId, pathId))
      ).map((row) => row.id)
    : null;

  const rows = await loadDataset(dataset, userId, nodeIds, pathId);
  const csv = UTF8_BOM + toCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="neurolearn-${dataset}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function loadDataset(
  dataset: 'responses' | 'nodes' | 'sessions',
  userId: string,
  nodeIds: string[] | null,
  pathId: string | undefined,
): Promise<Record<string, CsvValue>[]> {
  // Путь без узлов: пустая выгрузка, а не выгрузка всего подряд.
  if (nodeIds !== null && nodeIds.length === 0) return [];

  if (dataset === 'responses') {
    const rows = await db
      .select({
        created_at: userResponses.createdAt,
        node: knowledgeNodes.title,
        assessment_type: assessments.type,
        cognitive_level: assessments.cognitiveLevel,
        is_correct: userResponses.isCorrect,
        partial_score: userResponses.partialScore,
        response_time_ms: userResponses.responseTimeMs,
        jok_level: userResponses.jokLevel,
        confidence_level: userResponses.confidenceLevel,
        confidence_latency_ms: userResponses.confidenceLatencyMs,
        hints_used: userResponses.hintsUsed,
        session_id: userResponses.sessionId,
      })
      .from(userResponses)
      .innerJoin(assessments, eq(assessments.id, userResponses.assessmentId))
      .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, userResponses.nodeId))
      .where(
        and(
          eq(userResponses.userId, userId),
          ...(nodeIds ? [inArray(userResponses.nodeId, nodeIds)] : []),
        ),
      )
      .orderBy(asc(userResponses.createdAt));

    // Тексты ответов сознательно не выгружаются: для пересчёта метрик они не
    // нужны, а файл с ними легко уходит туда, куда человек его не собирался
    // отправлять.
    return rows;
  }

  if (dataset === 'nodes') {
    return db
      .select({
        node: knowledgeNodes.title,
        status: knowledgeNodes.status,
        knowledge_strength: nodeProgress.knowledgeStrength,
        automaticity_index: nodeProgress.automaticityIndex,
        accuracy_rate: nodeProgress.accuracyRate,
        median_response_time_ms: nodeProgress.medianResponseTimeMs,
        total_reps: nodeProgress.totalReps,
        calibration_gap: nodeProgress.calibrationGap,
        first_studied_at: nodeProgress.firstStudiedAt,
        mastered_at: nodeProgress.masteredAt,
        automated_at: nodeProgress.automatedAt,
        time_to_mastery_seconds: nodeProgress.timeToMasterySeconds,
      })
      .from(nodeProgress)
      .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, nodeProgress.nodeId))
      .where(
        and(
          eq(nodeProgress.userId, userId),
          ...(nodeIds ? [inArray(nodeProgress.nodeId, nodeIds)] : []),
        ),
      )
      .orderBy(asc(knowledgeNodes.title));
  }

  return db
    .select({
      started_at: practiceSessions.startedAt,
      completed_at: practiceSessions.completedAt,
      mode: practiceSessions.mode,
      interleaved: practiceSessions.interleaved,
      item_count: practiceSessions.itemCount,
      correct_count: practiceSessions.correctCount,
      score: practiceSessions.score,
      duration_ms: practiceSessions.durationMs,
    })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.userId, userId),
        ...(pathId ? [eq(practiceSessions.pathId, pathId)] : []),
      ),
    )
    .orderBy(asc(practiceSessions.startedAt));
}

export const dynamic = 'force-dynamic';
