import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';

/**
 * Состояние вводного тура.
 *
 * Пропуск сохраняется наравне с прохождением: человек, закрывший тур, принял
 * решение, и предлагать его снова при следующем входе — значит это решение
 * игнорировать.
 */
const schema = z.object({
  completed: z.boolean().optional(),
  skipped: z.boolean().optional(),
  lastStep: z.number().int().min(0).max(20).optional(),
  /** Явный перезапуск из настроек: человек захотел посмотреть тур ещё раз. */
  restart: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true, onboardedAt: true },
  });
  if (!user) return apiError('NOT_FOUND', 'Профиль не найден.');

  const preferences = withPreferenceDefaults(user.preferences);
  const onboarding = parsed.data.restart
    ? { completed: false, skipped: false, lastStep: 0 }
    : {
        completed: parsed.data.completed ?? preferences.onboarding.completed,
        skipped: parsed.data.skipped ?? preferences.onboarding.skipped,
        lastStep: parsed.data.lastStep ?? preferences.onboarding.lastStep,
      };

  await db
    .update(users)
    .set({
      preferences: { ...preferences, onboarding },
      // `onboardedAt` — момент первого закрытия тура любым способом; он
      // отвечает на вопрос «когда человек начал», а не «дочитал ли он до
      // конца», и потому ставится и при пропуске.
      onboardedAt: user.onboardedAt ?? (parsed.data.restart ? null : new Date()),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return NextResponse.json({ onboarding });
}
