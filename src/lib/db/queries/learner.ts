import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  fsrsCards,
  practiceSessions,
  reviewLogs,
  userResponses,
  users,
} from '@/lib/db/schema';
import { DEFAULT_COGNITIVE_PROFILE, type CognitiveProfile } from '@/lib/db/schema/types';
import {
  computeCognitiveProfile,
  type ProfileResponseSample,
  type ProfileReviewSample,
} from '@/lib/services/learner/profile';

/**
 * Запись когнитивного портрета — единственный писатель
 * `users.cognitive_profile`.
 *
 * Сам расчёт живёт в `services/learner/profile.ts` и базы не знает: здесь
 * только выборка наблюдений и запись результата.
 */

/**
 * Окно наблюдений. Всё время целиком брать нельзя: портрет должен отражать
 * то, как человек учится сейчас, а не среднее за всю историю — иначе
 * прогресс за полгода тонет в первых неделях. Двести ответов — это
 * примерно два-три десятка сессий.
 */
const RESPONSE_WINDOW = 200;
const REVIEW_WINDOW = 200;

export async function recomputeCognitiveProfile(userId: string): Promise<CognitiveProfile> {
  const responseRows = await db
    .select({
      isCorrect: userResponses.isCorrect,
      partialScore: userResponses.partialScore,
      responseTimeMs: userResponses.responseTimeMs,
      confidenceLevel: userResponses.confidenceLevel,
      interleaved: practiceSessions.interleaved,
    })
    .from(userResponses)
    // `innerJoin`, а не `leftJoin`: ответ без сессии (их быть не должно, но
    // колонка обнуляема) нельзя отнести ни к перемешанной практике, ни к
    // обычной, и в сравнение групп он внёс бы только шум.
    .innerJoin(practiceSessions, eq(practiceSessions.id, userResponses.sessionId))
    .where(eq(userResponses.userId, userId))
    .orderBy(desc(userResponses.createdAt))
    .limit(RESPONSE_WINDOW);

  const reviewRows = await db
    .select({ scheduledDays: reviewLogs.scheduledDays, rating: reviewLogs.rating })
    .from(reviewLogs)
    .where(eq(reviewLogs.userId, userId))
    .orderBy(desc(reviewLogs.reviewedAt))
    .limit(REVIEW_WINDOW);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { cognitiveProfile: true },
  });

  const profile = computeCognitiveProfile({
    previous: user?.cognitiveProfile ?? DEFAULT_COGNITIVE_PROFILE,
    responses: responseRows satisfies ProfileResponseSample[],
    reviews: reviewRows satisfies ProfileReviewSample[],
  });

  await db
    .update(users)
    .set({ cognitiveProfile: profile, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return profile;
}

/**
 * Суммарное время практики по узлу — сумма `duration_ms` завершённых
 * сессий, в которых по этому узлу были ответы.
 *
 * PRD §5 определяет `time_to_mastery_seconds` именно так, но колонка
 * `total_practice_ms` не имела писателя, и метрика считалась по стенным
 * часам (`automated_at − first_studied_at`). Разница принципиальная:
 * стенные часы включают недели, когда узел просто лежал в очереди.
 *
 * Считается на стороне базы: цифра нужна одна, а сессий по узлу за всё
 * время могут быть сотни.
 */
export async function totalPracticeMsForNode(userId: string, nodeId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${practiceSessions.durationMs}), 0)::int` })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.userId, userId),
        sql`exists (
          select 1 from ${userResponses}
          where ${userResponses.sessionId} = ${practiceSessions.id}
            and ${userResponses.nodeId} = ${nodeId}
        )`,
      ),
    );

  return rows[0]?.total ?? 0;
}

/**
 * Разрыв калибровки по узлу: средняя уверенность минус средняя точность
 * на последних ответах (PRD §3 п.5). Положительное — переоценка себя.
 *
 * Возвращает `null`, когда уверенность не собиралась: ноль означал бы
 * «калибровка идеальна», а это противоположно правде.
 */
export async function calibrationGapForNode(
  userId: string,
  nodeId: string,
  limit: number,
): Promise<number | null> {
  const rows = await db
    .select({
      isCorrect: userResponses.isCorrect,
      partialScore: userResponses.partialScore,
      confidenceLevel: userResponses.confidenceLevel,
    })
    .from(userResponses)
    .where(and(eq(userResponses.userId, userId), eq(userResponses.nodeId, nodeId)))
    .orderBy(desc(userResponses.createdAt))
    .limit(limit);

  const rated = rows.filter((row) => row.confidenceLevel !== null);
  if (rated.length === 0) return null;

  const confidence =
    rated.reduce((sum, row) => sum + ((row.confidenceLevel as number) - 1) / 4, 0) / rated.length;
  const accuracy =
    rated.reduce((sum, row) => sum + (row.isCorrect ? 1 : row.partialScore), 0) / rated.length;

  return confidence - accuracy;
}

/** Карточка узла — нужна вызывающим, чтобы не дублировать выборку. */
export async function cardIdForNode(userId: string, nodeId: string): Promise<string | null> {
  const card = await db.query.fsrsCards.findFirst({
    where: and(eq(fsrsCards.userId, userId), eq(fsrsCards.nodeId, nodeId)),
    columns: { id: true },
  });
  return card?.id ?? null;
}
