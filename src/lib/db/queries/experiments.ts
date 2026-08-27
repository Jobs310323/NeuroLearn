import { eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { experimentAssignments, fsrsCards, learningExperiments, reviewLogs } from '@/lib/db/schema';
import { assignArms, summarizeArmOutcomes, type ArmOutcome, type ExperimentReport } from '@/lib/services/learner/experiments';

/** Слой БД для N-of-1 экспериментов (F14). Рандомизация и отчёт — чистые функции в `services/learner/experiments.ts`. */

export async function createExperiment(params: {
  userId: string;
  hypothesis: string;
  variable: string;
  armA: Record<string, unknown>;
  armB: Record<string, unknown>;
  metric: string;
  windowDays?: number;
}) {
  const [row] = await db
    .insert(learningExperiments)
    .values({
      userId: params.userId,
      hypothesis: params.hypothesis,
      variable: params.variable,
      armA: params.armA,
      armB: params.armB,
      metric: params.metric,
      windowDays: params.windowDays ?? 7,
    })
    .returning();
  if (!row) throw new Error('Не удалось создать эксперимент.');
  return row;
}

/** Каждый узел закрепляется за веткой один раз — повторный вызов на уже назначенных узлах ничего не меняет. */
export async function assignNodesToExperiment(experimentId: string, nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return;
  const assignment = assignArms(nodeIds);
  await db
    .insert(experimentAssignments)
    .values([...assignment.entries()].map(([nodeId, arm]) => ({ experimentId, nodeId, arm })))
    .onConflictDoNothing({ target: [experimentAssignments.experimentId, experimentAssignments.nodeId] });
}

export async function startExperiment(experimentId: string): Promise<void> {
  await db
    .update(learningExperiments)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(learningExperiments.id, experimentId));
}

/**
 * Переопределение параметров подбора для узла, если он состоит в активном
 * эксперименте. Читает `selector.ts` при сборке набора практики — вот и всё
 * место, где ветка эксперимента реально меняет поведение приложения.
 */
export async function armOverrideForNode(nodeId: string): Promise<Record<string, unknown> | null> {
  const assignment = await db.query.experimentAssignments.findFirst({
    where: eq(experimentAssignments.nodeId, nodeId),
    with: { experiment: true },
  });
  if (!assignment || assignment.experiment.status !== 'running') return null;
  return (assignment.arm === 'a' ? assignment.experiment.armA : assignment.experiment.armB) as Record<
    string,
    unknown
  >;
}

/**
 * Честный отчёт (план, Фаза 3 п.3): показывает размер выборки и результат
 * по ветке, не один процент и не победителя при недостатке данных —
 * `readable` в `ExperimentReport` вызывающий код обязан проверить перед тем,
 * как показать вывод как решённый.
 */
export async function experimentReport(experimentId: string): Promise<ExperimentReport | null> {
  const experiment = await db.query.learningExperiments.findFirst({
    where: eq(learningExperiments.id, experimentId),
  });
  if (!experiment) return null;

  const assignments = await db.query.experimentAssignments.findMany({
    where: eq(experimentAssignments.experimentId, experimentId),
  });
  if (assignments.length === 0) return summarizeArmOutcomes([], experiment.windowDays);

  const nodeIds = assignments.map((a) => a.nodeId);
  const armByNode = new Map(assignments.map((a) => [a.nodeId, a.arm]));

  const cards = await db
    .select({ id: fsrsCards.id, nodeId: fsrsCards.nodeId })
    .from(fsrsCards)
    .where(inArray(fsrsCards.nodeId, nodeIds));
  if (cards.length === 0) return summarizeArmOutcomes([], experiment.windowDays);

  const armByCard = new Map(cards.map((c) => [c.id, armByNode.get(c.nodeId)!]));
  const cardIds = cards.map((c) => c.id);

  const logs = await db
    .select({ cardId: reviewLogs.cardId, rating: reviewLogs.rating, scheduledDays: reviewLogs.scheduledDays })
    .from(reviewLogs)
    .where(inArray(reviewLogs.cardId, cardIds));

  const outcomes: ArmOutcome[] = logs.map((log) => ({
    arm: armByCard.get(log.cardId) as ArmOutcome['arm'],
    rating: log.rating,
    scheduledDays: log.scheduledDays,
  }));

  return summarizeArmOutcomes(outcomes, experiment.windowDays);
}
