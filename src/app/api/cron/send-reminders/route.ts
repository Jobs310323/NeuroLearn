import { and, eq, isNull, lte } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { fsrsCards, pushSubscriptions } from '@/lib/db/schema';
import { logError } from '@/lib/monitoring/logger';
import { sendPush } from '@/lib/services/push/send';

/**
 * Vercel Cron: напоминания о просроченных повторениях (пробел №8 из
 * аналитического промта — до этого система не звала пользователя обратно,
 * только пассивно ждала на экране очереди).
 *
 * Политика — "напоминать, когда есть что напоминать": рассылка идёт, только
 * если у пользователя реально есть просроченные карточки (`fsrs_cards.due <=
 * now`), а не по расписанию вслепую. Раз в сутки (`vercel.json`) достаточно —
 * многократные напоминания в день скорее раздражают, чем помогают.
 */

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 });
    }
    console.warn('CRON_SECRET не задан: эндпоинт открыт. В production это ответ 500.');
  } else {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const now = new Date();

  // Условие по вложенному jsonb-полю (`preferences.reviewRemindersEnabled`)
  // типобезопасно через Drizzle не выразить — фильтруем в памяти:
  // пользователей на личной установке единицы, это не проблема.
  const owners = (await db.query.users.findMany()).filter((u) => u.preferences.reviewRemindersEnabled);

  const results: { userId: string; dueCount: number; sent: number; expiredRemoved: number }[] = [];

  for (const owner of owners) {
    const dueCards = await db
      .select({ id: fsrsCards.id })
      .from(fsrsCards)
      .where(and(eq(fsrsCards.userId, owner.id), lte(fsrsCards.due, now), isNull(fsrsCards.suspendedUntil)));

    if (dueCards.length === 0) {
      results.push({ userId: owner.id, dueCount: 0, sent: 0, expiredRemoved: 0 });
      continue;
    }

    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, owner.id));

    let sent = 0;
    let expiredRemoved = 0;

    for (const sub of subscriptions) {
      const result = await sendPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        {
          title: 'Пора повторить',
          body: `Карточек к повторению: ${dueCards.length}.`,
          url: '/review',
        },
      ).catch((error: unknown) => {
        logError(error, 'cron:send-reminders', { userId: owner.id });
        return { ok: false as const, expired: false, error: String(error) };
      });

      if (result.ok) {
        sent += 1;
      } else if (result.expired) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        expiredRemoved += 1;
      }
    }

    results.push({ userId: owner.id, dueCount: dueCards.length, sent, expiredRemoved });
  }

  return NextResponse.json({ checked: results.length, results });
}
