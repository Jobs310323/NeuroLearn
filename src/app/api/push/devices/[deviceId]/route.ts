import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { pushSubscriptions, users } from '@/lib/db/schema';

/**
 * Переименование и явный отзыв одной подписки.
 *
 * Отзыв со стороны сервера — не то же самое, что `subscription.unsubscribe()`
 * в браузере: он работает и тогда, когда устройства уже нет под рукой. Само
 * устройство при этом продолжит считать себя подписанным, пока не откроет
 * приложение — это ограничение Push API, а не недоделка: отозвать подписку
 * удалённо протокол не позволяет. Доставка прекращается сразу, потому что
 * строка удалена, а рассылка ходит по строкам.
 */

const renameSchema = z.object({ label: z.string().trim().min(1).max(60) });

const paramsSchema = z.object({ deviceId: z.uuid() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const id = paramsSchema.safeParse(await params);
  if (!id.success) return apiError('NOT_FOUND', 'Устройство не найдено.');

  const parsed = renameSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  const updated = await db
    .update(pushSubscriptions)
    .set({ label: parsed.data.label })
    .where(
      and(
        eq(pushSubscriptions.id, id.data.deviceId),
        eq(pushSubscriptions.userId, userId),
      ),
    )
    .returning({ id: pushSubscriptions.id });

  if (updated.length === 0) return apiError('NOT_FOUND', 'Устройство не найдено.');
  return NextResponse.json({ renamed: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const id = paramsSchema.safeParse(await params);
  if (!id.success) return apiError('NOT_FOUND', 'Устройство не найдено.');

  const deleted = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.id, id.data.deviceId),
        eq(pushSubscriptions.userId, userId),
      ),
    )
    .returning({ id: pushSubscriptions.id });

  if (deleted.length === 0) return apiError('NOT_FOUND', 'Устройство не найдено.');

  // Последнее устройство ушло — гасим и само предпочтение, иначе в настройках
  // остаётся «напоминания включены» при нулевой возможности их доставить.
  const remaining = await db.query.pushSubscriptions.findFirst({
    where: eq(pushSubscriptions.userId, userId),
    columns: { id: true },
  });
  if (!remaining) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { preferences: true },
    });
    if (user) {
      await db
        .update(users)
        .set({ preferences: { ...user.preferences, reviewRemindersEnabled: false } })
        .where(eq(users.id, userId));
    }
  }

  return NextResponse.json({ revoked: true, remaining: Boolean(remaining) });
}
