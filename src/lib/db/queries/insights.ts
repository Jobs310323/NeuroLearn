import { and, asc, eq, gte, inArray, isNotNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  assessments,
  knowledgeNodes,
  learningPaths,
  nodeProgress,
  practiceSessions,
  userResponses,
  users,
} from '@/lib/db/schema';
import { DEFAULT_COGNITIVE_PROFILE } from '@/lib/db/schema/types';
import {
  BLOOM_LEVELS,
  bloomTypeHeatmap,
  buildCalendar,
  cognitiveRadar,
  dailyTrend,
  type CalendarDay,
  type HeatCell,
  type RadarAxis,
  type TrendPoint,
} from '@/lib/services/analytics/insights';

/**
 * Данные развёрнутой аналитики. Чтение — здесь, расчёт — в чистых функциях
 * `services/analytics/insights.ts`: так каждую величину можно проверить
 * тестом, не поднимая базу.
 */

export type DeepInsights = {
  trend: TrendPoint[];
  heatmap: HeatCell[];
  radar: RadarAxis[];
  calendar: CalendarDay[];
  /** Период календаря в днях — подпись под ним, а не магическое число в вёрстке. */
  calendarDays: number;
};

const WINDOW_DAYS = 90;
const CALENDAR_DAYS = 84; // ровно 12 недель — календарь строится по неделям

export async function getDeepInsights(
  userId: string,
  pathId?: string,
  now = new Date(),
): Promise<DeepInsights | null> {
  if (pathId) {
    const owned = await db.query.learningPaths.findFirst({
      where: and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)),
      columns: { id: true },
    });
    if (!owned) return null;
  }

  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const nodeIds = pathId
    ? (
        await db
          .select({ id: knowledgeNodes.id })
          .from(knowledgeNodes)
          .where(eq(knowledgeNodes.pathId, pathId))
      ).map((row) => row.id)
    : null;

  // Путь без узлов: возвращаем пустую, но валидную витрину, а не null —
  // «путь не найден» и «в пути ещё нет узлов» это разные сообщения.
  if (nodeIds !== null && nodeIds.length === 0) {
    return {
      trend: [],
      heatmap: [],
      radar: cognitiveRadar(EMPTY_RADAR_INPUT),
      calendar: buildCalendar([], new Date(now.getTime() - CALENDAR_DAYS * 86_400_000), now),
      calendarDays: CALENDAR_DAYS,
    };
  }

  const [responseRows, progressRows, sessionRows, user] = await Promise.all([
    db
      .select({
        at: userResponses.createdAt,
        isCorrect: userResponses.isCorrect,
        responseTimeMs: userResponses.responseTimeMs,
        confidenceLevel: userResponses.confidenceLevel,
        cognitiveLevel: assessments.cognitiveLevel,
        assessmentType: assessments.type,
      })
      .from(userResponses)
      .innerJoin(assessments, eq(assessments.id, userResponses.assessmentId))
      .where(
        and(
          eq(userResponses.userId, userId),
          gte(userResponses.createdAt, since),
          ...(nodeIds ? [inArray(userResponses.nodeId, nodeIds)] : []),
        ),
      )
      .orderBy(asc(userResponses.createdAt)),

    db
      .select({
        at: nodeProgress.updatedAt,
        strength: nodeProgress.knowledgeStrength,
        automaticityIndex: nodeProgress.automaticityIndex,
        accuracyRate: nodeProgress.accuracyRate,
      })
      .from(nodeProgress)
      .where(
        and(
          eq(nodeProgress.userId, userId),
          ...(nodeIds ? [inArray(nodeProgress.nodeId, nodeIds)] : []),
        ),
      ),

    db
      .select({
        startedAt: practiceSessions.startedAt,
        durationMs: practiceSessions.durationMs,
        itemCount: practiceSessions.itemCount,
      })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, userId),
          isNotNull(practiceSessions.completedAt),
          gte(practiceSessions.startedAt, new Date(now.getTime() - CALENDAR_DAYS * 86_400_000)),
          ...(pathId ? [eq(practiceSessions.pathId, pathId)] : []),
        ),
      ),

    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { cognitiveProfile: true },
    }),
  ]);

  const profile = user?.cognitiveProfile ?? DEFAULT_COGNITIVE_PROFILE;

  const answered = responseRows.length;
  const accuracy = answered === 0 ? null : responseRows.filter((r) => r.isCorrect).length / answered;

  const rated = responseRows.filter((r) => r.confidenceLevel !== null);
  const calibrationGap =
    rated.length === 0
      ? null
      : rated.reduce((sum, r) => sum + ((r.confidenceLevel as number) - 1) / 4, 0) / rated.length -
        rated.filter((r) => r.isCorrect).length / rated.length;

  const automaticity =
    progressRows.length === 0
      ? null
      : progressRows.reduce((sum, row) => sum + row.automaticityIndex, 0) / progressRows.length;

  // Охват уровней Блума — доля уровней, по которым практика вообще была.
  const touchedLevels = new Set(
    responseRows.flatMap((row) => (row.cognitiveLevel === null ? [] : [row.cognitiveLevel])),
  );
  const bloomCoverage = answered === 0 ? null : touchedLevels.size / BLOOM_LEVELS.length;

  return {
    trend: dailyTrend(progressRows.map((row) => ({ at: row.at, strength: row.strength }))),
    heatmap: bloomTypeHeatmap(responseRows),
    radar: cognitiveRadar({
      accuracy,
      calibrationGap,
      automaticityIndex: automaticity,
      retentionIndex: profile.retentionIndex,
      interleavingTolerance: profile.interleavingTolerance,
      bloomCoverage,
    }),
    calendar: buildCalendar(
      sessionRows,
      new Date(now.getTime() - CALENDAR_DAYS * 86_400_000),
      now,
    ),
    calendarDays: CALENDAR_DAYS,
  };
}

const EMPTY_RADAR_INPUT = {
  accuracy: null,
  calibrationGap: null,
  automaticityIndex: null,
  retentionIndex: null,
  interleavingTolerance: null,
  bloomCoverage: null,
};
