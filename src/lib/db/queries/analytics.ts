import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  knowledgeNodes,
  learningPaths,
  nodeProgress,
  practiceSessions,
  userResponses,
} from '@/lib/db/schema';
import { responseTimeVariability } from '@/lib/services/practice/fatigue';

/** Витрина аналитики — `docs/API.md` §8. Первая версия: одна страница, без клиентского fetch. */

export type AnalyticsOverview = {
  mastery: Record<'notStarted' | 'inProgress' | 'mastered' | 'automated' | 'hasGaps' | 'needsReview', number>;
  strengthDistribution: { bucket: string; count: number }[];
  timeToMastery: { medianSeconds: number | null; byNode: { nodeId: string; title: string; seconds: number }[] };
  interleavingEffect: { blockedAccuracy: number | null; interleavedAccuracy: number | null };
  calibration: { meanConfidence: number | null; accuracy: number | null; gap: number | null };
  /**
   * Наблюдение, план Фаза 1 п.12: коэффициент вариации времени ответа по
   * последним завершённым сессиям. Не влияет ни на что в подборе —
   * только витрина, пока сигнал не проверен временем.
   */
  fatigueTrend: { sessionsAnalyzed: number; latestCv: number | null; recentAverageCv: number | null };
};

const STRENGTH_BUCKETS = ['0–20', '21–40', '41–60', '61–80', '81–100'] as const;
const FATIGUE_SESSION_WINDOW = 10;

function bucketFor(strength: number): (typeof STRENGTH_BUCKETS)[number] {
  if (strength <= 20) return '0–20';
  if (strength <= 40) return '21–40';
  if (strength <= 60) return '41–60';
  if (strength <= 80) return '61–80';
  return '81–100';
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export async function getAnalyticsOverview(userId: string, pathId?: string): Promise<AnalyticsOverview | null> {
  if (pathId) {
    const owned = await db.query.learningPaths.findFirst({
      where: and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)),
    });
    if (!owned) return null;
  }

  const nodes = await db
    .select({ id: knowledgeNodes.id, title: knowledgeNodes.title, status: knowledgeNodes.status })
    .from(knowledgeNodes)
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(and(eq(learningPaths.userId, userId), pathId ? eq(knowledgeNodes.pathId, pathId) : undefined));

  const nodeIds = nodes.map((n) => n.id);
  const titleByNode = new Map(nodes.map((n) => [n.id, n.title]));

  const mastery = {
    notStarted: nodes.filter((n) => n.status === 'not_started').length,
    inProgress: nodes.filter((n) => n.status === 'in_progress').length,
    mastered: nodes.filter((n) => n.status === 'mastered').length,
    automated: nodes.filter((n) => n.status === 'automated').length,
    hasGaps: nodes.filter((n) => n.status === 'has_gaps').length,
    needsReview: nodes.filter((n) => n.status === 'needs_review').length,
  };

  const progress = nodeIds.length === 0 ? [] : await db.select().from(nodeProgress).where(inArray(nodeProgress.nodeId, nodeIds));

  const bucketCounts = new Map<string, number>(STRENGTH_BUCKETS.map((b) => [b, 0]));
  for (const row of progress) {
    const bucket = bucketFor(row.knowledgeStrength);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }
  const strengthDistribution = STRENGTH_BUCKETS.map((bucket) => ({ bucket, count: bucketCounts.get(bucket) ?? 0 }));

  const withTimeToMastery = progress.filter(
    (row): row is typeof row & { timeToMasterySeconds: number } => row.timeToMasterySeconds != null,
  );
  const timeToMastery = {
    medianSeconds: median(withTimeToMastery.map((r) => r.timeToMasterySeconds)),
    byNode: withTimeToMastery
      .map((r) => ({ nodeId: r.nodeId, title: titleByNode.get(r.nodeId) ?? '—', seconds: r.timeToMasterySeconds }))
      .sort((a, b) => a.seconds - b.seconds),
  };

  const sessions = await db
    .select({ interleaved: practiceSessions.interleaved, score: practiceSessions.score })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.userId, userId),
        isNotNull(practiceSessions.score),
        pathId ? eq(practiceSessions.pathId, pathId) : undefined,
      ),
    );
  const interleavingEffect = {
    blockedAccuracy: mean(sessions.filter((s) => !s.interleaved).map((s) => s.score as number)),
    interleavedAccuracy: mean(sessions.filter((s) => s.interleaved).map((s) => s.score as number)),
  };

  const responses =
    nodeIds.length === 0
      ? []
      : await db
          .select({
            isCorrect: userResponses.isCorrect,
            partialScore: userResponses.partialScore,
            confidenceLevel: userResponses.confidenceLevel,
          })
          .from(userResponses)
          .where(and(eq(userResponses.userId, userId), inArray(userResponses.nodeId, nodeIds), isNotNull(userResponses.confidenceLevel)));
  const meanConfidence = mean(responses.map((r) => ((r.confidenceLevel as number) - 1) / 4));
  const calibrationAccuracy = mean(responses.map((r) => (r.isCorrect ? 1 : r.partialScore)));
  const calibration = {
    meanConfidence,
    accuracy: calibrationAccuracy,
    gap: meanConfidence != null && calibrationAccuracy != null ? meanConfidence - calibrationAccuracy : null,
  };

  const recentSessions = await db
    .select({ id: practiceSessions.id })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.userId, userId),
        isNotNull(practiceSessions.completedAt),
        pathId ? eq(practiceSessions.pathId, pathId) : undefined,
      ),
    )
    .orderBy(desc(practiceSessions.completedAt))
    .limit(FATIGUE_SESSION_WINDOW);

  const sessionIds = recentSessions.map((s) => s.id);
  const fatigueResponses =
    sessionIds.length === 0
      ? []
      : await db
          .select({
            sessionId: userResponses.sessionId,
            responseTimeMs: userResponses.responseTimeMs,
            isCorrect: userResponses.isCorrect,
          })
          .from(userResponses)
          .where(inArray(userResponses.sessionId, sessionIds));

  const bySession = new Map<string, { responseTimeMs: number; isCorrect: boolean }[]>();
  for (const r of fatigueResponses) {
    if (!r.sessionId) continue;
    const bucket = bySession.get(r.sessionId) ?? [];
    bucket.push({ responseTimeMs: r.responseTimeMs, isCorrect: r.isCorrect });
    bySession.set(r.sessionId, bucket);
  }
  // `recentSessions` уже упорядочены от новой к старой — порядок сохраняется через `.map`.
  const perSessionCv = recentSessions.map((s) => responseTimeVariability(bySession.get(s.id) ?? []));
  const validCvs = perSessionCv.filter((v): v is number => v !== null);
  const fatigueTrend = {
    sessionsAnalyzed: validCvs.length,
    latestCv: perSessionCv.find((v) => v !== null) ?? null,
    recentAverageCv: validCvs.length > 0 ? validCvs.reduce((a, b) => a + b, 0) / validCvs.length : null,
  };

  return { mastery, strengthDistribution, timeToMastery, interleavingEffect, calibration, fatigueTrend };
}
