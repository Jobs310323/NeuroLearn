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

/**
 * Сколько логов повторений должно накопиться, чтобы переоптимизация имела
 * смысл. `FSRS_TEST_THRESHOLD` понижает порог — иначе весь путь «cron взвёл
 * флаг, оптимизатор посчитал веса, `apply-fsrs-weights` их применил» нельзя
 * пройти ни разу, пока не наберётся две сотни настоящих повторений.
 */
const DEFAULT_READY_THRESHOLD = 200;

function readyThreshold(request: Request): number {
  // Параметр запроса нужен `scripts/force-fsrs-optimize.ts`: переменную
  // окружения он подменить не может (её читает уже запущенный сервер), а
  // пройти путь целиком иначе нельзя. Доступен только после проверки секрета
  // выше, поэтому снаружи порог не подкрутить.
  const fromQuery = Number(new URL(request.url).searchParams.get('threshold'));
  if (Number.isInteger(fromQuery) && fromQuery > 0) return fromQuery;

  const fromEnv = Number(process.env.FSRS_TEST_THRESHOLD);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;

  return DEFAULT_READY_THRESHOLD;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  // Проверка обязательна в проде. Прежняя форма (`if (secret) { ... }`)
  // выключала защиту ровно тогда, когда переменную забыли задать, — то есть
  // отсутствие настройки открывало эндпоинт вместо того, чтобы сломать его
  // заметно. Отказ с 500 виден в первом же прогоне Vercel Cron.
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'CRON_SECRET not set' },
        { status: 500 },
      );
    }
    console.warn('CRON_SECRET не задан: эндпоинт открыт. В production это ответ 500.');
  } else {
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

  const threshold = readyThreshold(request);
  const logsSinceLastFit = row?.n ?? 0;
  const ready = logsSinceLastFit >= threshold;

  if (ready && !owner.preferences.fsrsOptimizationReady) {
    await db
      .update(users)
      .set({ preferences: { ...owner.preferences, fsrsOptimizationReady: true } })
      .where(eq(users.id, owner.id));
  }

  return NextResponse.json({ checked: true, logsSinceLastFit, threshold, ready });
}
