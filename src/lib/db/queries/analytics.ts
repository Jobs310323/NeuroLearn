import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  knowledgeNodes,
  learningPaths,
  nodeProgress,
  practiceSessions,
  userResponses,
} from '@/lib/db/schema';

/** Витрина аналитики — `docs/API.md` §8. Первая версия: одна страница, без клиентского fetch. */

export type AnalyticsOverview = {
  mastery: Record<'notStarted' | 'inProgress' | 'mastered' | 'automated' | 'hasGaps' | 'needsReview', number>;
  strengthDistribution: { bucket: string; count: number }[];
  timeToMastery: { medianSeconds: number | null; byNode: { nodeId: string; title: string; seconds: number }[] };
  interleavingEffect: { blockedAccuracy: number | null; interleavedAccuracy: number | null };
  calibration: { meanConfidence: number | null; accuracy: number | null; gap: number | null };
};

const STRENGTH_BUCKETS = ['0–20', '21–40', '41–60', '61–80', '81–100'] as const;

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

  return { mastery, strengthDistribution, timeToMastery, interleavingEffect, calibration };
}
