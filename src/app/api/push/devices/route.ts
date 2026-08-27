import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { unauthorized } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema';
import { describeDevice } from '@/lib/services/push/device-name';

/**
 * Список push-подписок пользователя — «управление устройствами» из плана.
 *
 * До этого подписки были невидимы: отписаться можно было только с того же
 * устройства, а строку от потерянного телефона нельзя было убрать вообще.
 *
 * `endpoint` наружу не отдаётся целиком: это секрет доставки (кто им владеет,
 * тот шлёт уведомления). Для узнавания достаточно хвоста.
 */
export async function GET(): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.createdAt));

  return NextResponse.json({
    // Честное отключение: без ключей VAPID подписки нерабочие, и список
    // обязан это показывать, а не притворяться живым (решение владельца —
    // ключи в код не берём).
    pushConfigured: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    devices: rows.map((row) => ({
      id: row.id,
      label: row.label ?? describeDevice(row.userAgent),
      autoLabel: describeDevice(row.userAgent),
      endpointTail: row.endpoint.slice(-12),
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    })),
  });
}
