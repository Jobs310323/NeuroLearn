import { and, asc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  fsrsCards,
  knowledgeNodes,
  learningPaths,
  nodeProgress,
  notes,
  practiceSessions,
  users,
} from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';

/**
 * Виджет «Сегодня»: что реально стоит сделать в ближайший час.
 *
 * Все числа здесь детерминированные и объяснимые. Это принципиально:
 * дашборд, показывающий «рекомендуемое время» без объяснения, откуда оно
 * взялось, воспитывает доверие к цифре, а не понимание собственного
 * обучения. Каждая величина ниже выводится из наблюдаемых данных, и рядом с
 * ней в интерфейсе стоит, из чего именно.
 */

export type TodayCard = {
  nodeId: string;
  nodeTitle: string;
  pathId: string;
  pathTitle: string;
  due: string;
  overdueDays: number;
  knowledgeStrength: number;
  status: string;
  estimatedMinutes: number;
};

export type TodayView = {
  cards: TodayCard[];
  /**
   * Рекомендуемое время = сумма оценок по узлам к повторению, ограниченная
   * дневной целью. Не «сколько надо заниматься», а «сколько займёт то, что
   * подошло по сроку».
   */
  recommendedMinutes: number;
  dailyGoalMinutes: number;
  /** Заметки, которым пора вернуться. */
  dueNotes: { noteId: string; title: string; nodeTitle: string | null; isCapsule: boolean }[];
  /** Прогноз завершения ближайшего модуля — по фактическому темпу, а не по плану. */
  forecast: {
    pathId: string;
    pathTitle: string;
    remainingNodes: number;
    nodesPerWeek: number | null;
    estimatedDate: string | null;
  } | null;
  /** Сессий за последние 7 дней — контекст для прогноза, не достижение. */
  sessionsLastWeek: number;
};

const WEEK_MS = 7 * 86_400_000;

export async function getTodayView(userId: string, now = new Date()): Promise<TodayView> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { dailyGoalMinutes: true, preferences: true },
  });
  const dailyGoalMinutes = user?.dailyGoalMinutes ?? 20;
  const aiOnNotes = withPreferenceDefaults(user?.preferences).aiOnNotes;
  void aiOnNotes; // читается экраном отдельно; здесь только чтобы профиль был один запрос

  const [dueRows, noteRows, sessions, pathStats] = await Promise.all([
    db
      .select({
        nodeId: knowledgeNodes.id,
        nodeTitle: knowledgeNodes.title,
        pathId: learningPaths.id,
        pathTitle: learningPaths.title,
        due: fsrsCards.due,
        status: knowledgeNodes.status,
        estimatedMinutes: knowledgeNodes.estimatedMinutes,
        knowledgeStrength: nodeProgress.knowledgeStrength,
      })
      .from(fsrsCards)
      .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, fsrsCards.nodeId))
      .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
      .leftJoin(nodeProgress, eq(nodeProgress.nodeId, knowledgeNodes.id))
      .where(and(eq(fsrsCards.userId, userId), lte(fsrsCards.due, now)))
      .orderBy(asc(fsrsCards.due))
      .limit(20),

    db
      .select({
        noteId: notes.id,
        title: notes.title,
        nodeTitle: knowledgeNodes.title,
        capsule: notes.capsule,
      })
      .from(notes)
      .leftJoin(knowledgeNodes, eq(knowledgeNodes.id, notes.nodeId))
      .where(
        and(
          eq(notes.userId, userId),
          eq(notes.isArchived, false),
          isNotNull(notes.resurfaceAt),
          lte(notes.resurfaceAt, now),
        ),
      )
      .orderBy(asc(notes.resurfaceAt))
      .limit(5),

    db
      .select({ value: sql<number>`count(*)::int` })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, userId),
          isNotNull(practiceSessions.completedAt),
          gte(practiceSessions.startedAt, new Date(now.getTime() - WEEK_MS)),
        ),
      ),

    db
      .select({
        pathId: learningPaths.id,
        pathTitle: learningPaths.title,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${knowledgeNodes.status} in ('mastered','automated'))::int`,
      })
      .from(knowledgeNodes)
      .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
      .where(and(eq(learningPaths.userId, userId), eq(learningPaths.status, 'active')))
      .groupBy(learningPaths.id, learningPaths.title),
  ]);

  const cards: TodayCard[] = dueRows.map((row) => ({
    nodeId: row.nodeId,
    nodeTitle: row.nodeTitle,
    pathId: row.pathId,
    pathTitle: row.pathTitle,
    due: row.due.toISOString(),
    overdueDays: Math.max(0, Math.floor((now.getTime() - row.due.getTime()) / 86_400_000)),
    knowledgeStrength: row.knowledgeStrength ?? 0,
    status: row.status,
    estimatedMinutes: row.estimatedMinutes,
  }));

  // Минуты — сумма оценок, но не больше дневной цели: показывать «нужно 180
  // минут» человеку, поставившему цель 20, значит гарантированно его
  // демотивировать. Остальное подождёт до завтра, в этом и смысл расписания.
  const recommendedMinutes = Math.min(
    dailyGoalMinutes,
    cards.reduce((sum, card) => sum + card.estimatedMinutes, 0),
  );

  return {
    cards,
    recommendedMinutes,
    dailyGoalMinutes,
    dueNotes: noteRows.map((row) => ({
      noteId: row.noteId,
      title: row.title ?? 'Без названия',
      nodeTitle: row.nodeTitle,
      isCapsule: row.capsule !== null,
    })),
    forecast: buildForecast(pathStats, sessions[0]?.value ?? 0, now),
    sessionsLastWeek: sessions[0]?.value ?? 0,
  };
}

/**
 * Прогноз строится по фактическому темпу за неделю, а не по плановым оценкам
 * времени. Оценка «20 минут на узел» — это оценка сложности материала, а не
 * предсказание того, когда человек до него доберётся; путать их значит
 * обещать дату, которая не сбудется.
 *
 * Нет данных за неделю — нет прогноза. Дата, выведенная из нуля сессий, была
 * бы выдумкой.
 */
function buildForecast(
  paths: { pathId: string; pathTitle: string; total: number; done: number }[],
  sessionsLastWeek: number,
  now: Date,
): TodayView['forecast'] {
  const active = paths
    .map((path) => ({ ...path, remaining: path.total - path.done }))
    .filter((path) => path.remaining > 0)
    .sort((a, b) => a.remaining - b.remaining)[0];

  if (!active) return null;

  // Грубая, но честная связка: одна завершённая сессия ≈ продвижение по
  // одному узлу. Точнее без длинной истории всё равно не выйдет, и точность
  // здесь дороже прозрачности.
  const nodesPerWeek = sessionsLastWeek > 0 ? sessionsLastWeek : null;
  const estimatedDate =
    nodesPerWeek === null
      ? null
      : new Date(now.getTime() + (active.remaining / nodesPerWeek) * WEEK_MS).toISOString();

  return {
    pathId: active.pathId,
    pathTitle: active.pathTitle,
    remainingNodes: active.remaining,
    nodesPerWeek,
    estimatedDate,
  };
}
