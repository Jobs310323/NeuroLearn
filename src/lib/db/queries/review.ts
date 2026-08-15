import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { fsrs, generatorParameters } from 'ts-fsrs';

import { db } from '@/lib/db';
import { fsrsCards, knowledgeNodes, learningPaths, users } from '@/lib/db/schema';
import { DEFAULT_USER_PREFERENCES } from '@/lib/db/schema/types';
import { rowToCard } from '@/lib/services/fsrs/mapping';

/** Очередь повторений — контракт `docs/API.md` §4. */

export type ReviewQueueItem = {
  cardId: string;
  nodeId: string;
  nodeTitle: string;
  pathTitle: string;
  due: string;
  state: string;
  retrievability: number;
  lapses: number;
  weight: number;
  estimatedMinutes: number;
};

export type ReviewQueue = {
  due: ReviewQueueItem[];
  counts: { overdue: number; today: number; upcoming7d: number };
  forecast: { date: string; count: number }[];
};

export async function getReviewQueue(
  userId: string,
  params: { pathId?: string; limit: number; horizon: 'today' | 'week' },
): Promise<ReviewQueue> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { preferences: true } });
  const requestRetention = user?.preferences.requestRetention ?? DEFAULT_USER_PREFERENCES.requestRetention;
  const engine = fsrs(generatorParameters({ request_retention: requestRetention }));
  const now = new Date();

  const horizonEnd = new Date(now);
  if (params.horizon === 'today') horizonEnd.setHours(23, 59, 59, 999);
  else horizonEnd.setDate(horizonEnd.getDate() + 7);

  const rows = await db
    .select({
      card: fsrsCards,
      nodeId: knowledgeNodes.id,
      nodeTitle: knowledgeNodes.title,
      weight: knowledgeNodes.weight,
      estimatedMinutes: knowledgeNodes.estimatedMinutes,
      pathTitle: learningPaths.title,
    })
    .from(fsrsCards)
    .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, fsrsCards.nodeId))
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(
      and(
        eq(fsrsCards.userId, userId),
        lte(fsrsCards.due, horizonEnd),
        params.pathId ? eq(learningPaths.id, params.pathId) : undefined,
      ),
    )
    .orderBy(asc(fsrsCards.due));

  const withRetrievability = rows.map((row) => {
    const retrievability = row.card.reps > 0 ? engine.get_retrievability(rowToCard(row.card), now, false) : 0;
    return { ...row, due: row.card.due, state: row.card.state, lapses: row.card.lapses, retrievability };
  });

  withRetrievability.sort((a, b) => {
    const overdueDiff = a.due.getTime() - b.due.getTime();
    if (overdueDiff !== 0 && (a.due <= now || b.due <= now)) return overdueDiff;
    return b.weight * (1 - b.retrievability) - a.weight * (1 - a.retrievability);
  });

  const limited = withRetrievability.slice(0, params.limit);

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const in7Days = new Date(now);
  in7Days.setDate(in7Days.getDate() + 7);

  const overdue = withRetrievability.filter((r) => r.due < startOfToday).length;
  const today = withRetrievability.filter((r) => r.due >= startOfToday && r.due <= endOfToday).length;
  const upcoming7d = withRetrievability.filter((r) => r.due > endOfToday && r.due <= in7Days).length;

  const forecastMap = new Map<string, number>();
  for (const row of withRetrievability) {
    if (row.due > in7Days) continue;
    const key = row.due.toISOString().slice(0, 10);
    forecastMap.set(key, (forecastMap.get(key) ?? 0) + 1);
  }
  const forecast = [...forecastMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => ({ date, count }));

  return {
    due: limited.map((row) => ({
      cardId: row.card.id,
      nodeId: row.nodeId,
      nodeTitle: row.nodeTitle,
      pathTitle: row.pathTitle,
      due: row.due.toISOString(),
      state: row.state,
      retrievability: row.retrievability,
      lapses: row.lapses,
      weight: row.weight,
      estimatedMinutes: row.estimatedMinutes,
    })),
    counts: { overdue, today, upcoming7d },
    forecast,
  };
}

export async function assertCardOwnership(userId: string, cardId: string) {
  const card = await db.query.fsrsCards.findFirst({
    where: and(eq(fsrsCards.id, cardId), eq(fsrsCards.userId, userId)),
  });
  return card ?? null;
}

export async function assertCardsOwnedBy(userId: string, cardIds: string[]) {
  return db
    .select({ id: fsrsCards.id })
    .from(fsrsCards)
    .where(and(eq(fsrsCards.userId, userId), inArray(fsrsCards.id, cardIds)));
}
