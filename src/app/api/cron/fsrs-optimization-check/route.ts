import { and, count, eq, gt } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { reviewLogs, users } from '@/lib/db/schema';

/**
 * Vercel Cron: проверяет, накопилось ли достаточно логов повторений для
 * переоптимизации персональных весов FSRS. `fsrs-optimizer` (Python/PyTorch)
 * онлайн не запускается — этот endpoint только взводит флаг `fsrsOptimizationReady`,
 * саму оптимизацию пользователь прогоняет вручную (`docs`: экспорт логов + optimizer + `apply-fsrs-weights.ts`).
 */

const READY_THRESHOLD = 200;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const owner = await db.query.users.findFirst();
  if (!owner) return NextResponse.json({ checked: false, reason: 'no user' });

  const since = owner.preferences.fsrsWeightsUpdatedAt
    ? new Date(owner.preferences.fsrsWeightsUpdatedAt)
    : new Date(0);

  const [row] = await db
    .select({ n: count() })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, owner.id), gt(reviewLogs.reviewedAt, since)));

  const logsSinceLastFit = row?.n ?? 0;
  const ready = logsSinceLastFit >= READY_THRESHOLD;

  if (ready && !owner.preferences.fsrsOptimizationReady) {
    await db
      .update(users)
      .set({ preferences: { ...owner.preferences, fsrsOptimizationReady: true } })
      .where(eq(users.id, owner.id));
  }

  return NextResponse.json({ checked: true, logsSinceLastFit, ready });
}
