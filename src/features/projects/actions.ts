'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { scoreDefense } from '@/lib/ai/agents/defense-coach';
import { loadHistory } from '@/lib/ai/agents/tutor';
import { requireUserId } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { projects, projectSubmissions } from '@/lib/db/schema';
import { loadSubmissionForDefense } from '@/lib/db/queries/projects';
import { recomputeNodeProgress } from '@/lib/db/queries/progress';
import { submitProjectSchema } from '@/lib/validation/projects';

/**
 * Server Actions тонкие (тот же принцип, что в `learning-path/actions.ts`):
 * разбор Zod → вызов Drizzle/агента → инвалидация кэша.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function submitProject(input: unknown): Promise<ActionResult<{ submissionId: string }>> {
  const userId = await requireUserId();
  const parsed = submitProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const [project] = await db
    .select({ id: projects.id, pathId: projects.pathId })
    .from(projects)
    .where(eq(projects.id, parsed.data.projectId));
  if (!project) return { ok: false, error: 'Проект не найден' };

  const [submission] = await db
    .insert(projectSubmissions)
    .values({
      projectId: parsed.data.projectId,
      userId,
      status: 'submitted',
      artifactUrl: parsed.data.artifactUrl ?? null,
      content: parsed.data.content ?? null,
      submittedAt: new Date(),
    })
    .returning({ id: projectSubmissions.id });

  if (!submission) return { ok: false, error: 'Не удалось сохранить сдачу' };

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true, data: { submissionId: submission.id } };
}

/**
 * Завершает защиту: собирает стенограмму диалога, оценивает по рубрике
 * (`scoreDefense`, LLM с Zod-валидацией — не парсинг tool-вызовов, тот же
 * надёжный путь, что и весь остальной структурированный вывод в проекте),
 * взвешивает по весам критериев и, при слабых критериях, возвращает
 * покрытые проектом узлы в `has_gaps` через уже существующий механизм
 * `recomputeNodeProgress` (`hasGapFromProjectDefense` в transitions.ts).
 */
export async function finalizeDefense(submissionId: string): Promise<ActionResult<{ defenseScore: number }>> {
  const userId = await requireUserId();
  const submission = await loadSubmissionForDefense(userId, submissionId);
  if (!submission) return { ok: false, error: 'Сдача не найдена' };
  if (!submission.defenseConversationId) return { ok: false, error: 'Диалог защиты ещё не начат' };

  const messages = await loadHistory(submission.defenseConversationId, 200);
  if (messages.length === 0) return { ok: false, error: 'В диалоге защиты пока нет сообщений' };

  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'Студент' : 'Коуч'}: ${m.content}`)
    .join('\n');

  const scored = await scoreDefense({
    userId,
    submissionId,
    criteria: submission.criteria,
    transcript,
  });

  const weightSum = submission.criteria.reduce((sum, c) => sum + c.weight, 0) || 1;
  const defenseScore =
    scored.rubricScores.reduce((sum, r) => {
      const weight = submission.criteria.find((c) => c.id === r.criterionId)?.weight ?? 0;
      return sum + r.score * weight;
    }, 0) / weightSum;

  const weakCriteria = scored.rubricScores.filter((r) => r.score < 0.5);
  const revealedGapNodeIds = weakCriteria.length > 0 ? submission.coveredNodeIds : [];

  const now = new Date();
  await db
    .update(projectSubmissions)
    .set({
      rubricScores: Object.fromEntries(scored.rubricScores.map((r) => [r.criterionId, r.score])),
      defenseScore,
      revealedGapNodeIds,
      status: defenseScore >= 0.6 ? 'accepted' : 'revisions_requested',
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(projectSubmissions.id, submissionId));

  // `reviewedAt` только что записан — `recomputeNodeProgress` увидит его как
  // "после masteredAt" и переведёт узел в has_gaps, если он там уже был.
  for (const nodeId of revealedGapNodeIds) {
    await recomputeNodeProgress(userId, nodeId, now);
  }

  revalidatePath(`/projects/submissions/${submissionId}/defense`);
  return { ok: true, data: { defenseScore } };
}
