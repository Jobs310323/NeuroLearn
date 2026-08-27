import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { pushSubscriptions, users } from '@/lib/db/schema';

/** Подписка — единственное реальное доказательство, что напоминания можно слать; включает флаг предпочтения тем же действием. */
async function setReminders(userId: string, enabled: boolean): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { preferences: true } });
  if (!user) return;
  await db
    .update(users)
    .set({ preferences: { ...user.preferences, reviewRemindersEnabled: enabled } })
    .where(eq(users.id, userId));
}

/** Подписка/отписка Web Push для устройства. */

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
    }
    throw error;
  }

  const parsed = subscribeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_FAILED', message: 'Некорректная подписка' } }, { status: 400 });
  }

  // `endpoint` уникален на устройство/браузер — повторная подписка того же
  // устройства обновляет ключи, а не копит дубли (например, после сброса
  // данных сайта в браузере ключи меняются, endpoint обычно тоже).
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, lastSeenAt: new Date() },
    });
  await setReminders(userId, true);

  return NextResponse.json({ subscribed: true });
}

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

export async function DELETE(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
    }
    throw error;
  }

  const parsed = unsubscribeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' } }, { status: 400 });
  }

  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, parsed.data.endpoint)));

  // Выключаем предпочтение только если это было последнее устройство —
  // другие подписки могли остаться живыми.
  const remaining = await db.query.pushSubscriptions.findFirst({ where: eq(pushSubscriptions.userId, userId) });
  if (!remaining) await setReminders(userId, false);

  return NextResponse.json({ unsubscribed: true });
}
