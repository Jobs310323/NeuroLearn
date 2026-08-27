'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUserId } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { learningPaths } from '@/lib/db/schema';
import {
  createLearningPathSchema,
  updateLearningPathSchema,
} from '@/lib/validation/learning';

/**
 * Server Actions тонкие: разбор Zod → вызов Drizzle → инвалидация кэша.
 * Бизнес-логики здесь нет — она в `lib/services`.
 */

/**
 * `conflict` заполняется, когда отказ вызван расхождением версий, а не
 * ошибкой ввода. Клиенту нужен не только текст — ему нужна серверная версия,
 * чтобы перечитать состояние и не потерять чужую работу.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; conflict?: { serverLayoutVersion: number } };

export async function createLearningPath(
  input: unknown,
): Promise<ActionResult<{ pathId: string }>> {
  const userId = await requireUserId();
  const parsed = createLearningPathSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const [created] = await db
    .insert(learningPaths)
    .values({
      userId,
      title: parsed.data.title,
      goal: parsed.data.goal,
      description: parsed.data.description ?? null,
      targetLevel: parsed.data.targetLevel ?? null,
      status: 'draft',
    })
    .returning({ id: learningPaths.id });

  if (!created) return { ok: false, error: 'Не удалось создать путь' };

  revalidatePath('/paths');
  return { ok: true, data: { pathId: created.id } };
}

export async function updateLearningPath(input: unknown): Promise<ActionResult<null>> {
  const userId = await requireUserId();
  const parsed = updateLearningPathSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const { pathId, ...fields } = parsed.data;
  const updated = await db
    .update(learningPaths)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)))
    .returning({ id: learningPaths.id });

  if (updated.length === 0) return { ok: false, error: 'Путь не найден' };

  revalidatePath('/paths');
  revalidatePath(`/paths/${pathId}`);
  return { ok: true, data: null };
}

export async function deleteLearningPath(pathId: string): Promise<ActionResult<null>> {
  const userId = await requireUserId();

  const deleted = await db
    .delete(learningPaths)
    .where(and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)))
    .returning({ id: learningPaths.id });

  if (deleted.length === 0) return { ok: false, error: 'Путь не найден' };

  revalidatePath('/paths');
  return { ok: true, data: null };
}
