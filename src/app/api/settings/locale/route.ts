import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';
import { LOCALES } from '@/lib/i18n/config';

/**
 * Язык интерфейса в профиле.
 *
 * Cookie переключает язык на этом устройстве мгновенно; профиль нужен, чтобы
 * выбор пережил смену устройства и очистку данных сайта. Отсюда два места
 * хранения — это не дублирование, а разные сроки жизни.
 */
const localeSchema = z.object({ locale: z.enum(LOCALES) });

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const parsed = localeSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true },
  });
  if (!user) return apiError('NOT_FOUND', 'Профиль не найден.');

  await db
    .update(users)
    .set({
      preferences: { ...withPreferenceDefaults(user.preferences), locale: parsed.data.locale },
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return NextResponse.json({ locale: parsed.data.locale });
}
