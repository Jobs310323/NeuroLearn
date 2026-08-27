import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';

/**
 * Разрешение AI работать с содержимым тетради.
 *
 * Отдельный маршрут, а не поле в общих настройках: это согласие на передачу
 * личного текста стороннему сервису, и оно должно быть отдельным явным
 * действием, а не одним из полей формы, сохраняемой оптом.
 */
const schema = z.object({ aiOnNotes: z.boolean() });

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
    columns: { preferences: true },
  });
  if (!user) return apiError('NOT_FOUND', 'Профиль не найден.');

  await db
    .update(users)
    .set({
      preferences: { ...withPreferenceDefaults(user.preferences), aiOnNotes: parsed.data.aiOnNotes },
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return NextResponse.json({ aiOnNotes: parsed.data.aiOnNotes });
}
