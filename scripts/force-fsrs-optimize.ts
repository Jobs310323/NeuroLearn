import { config } from 'dotenv';
config({ path: '.env.local' });

const { enableEnvProxy } = await import('@/lib/net/proxy');
enableEnvProxy();

const { db } = await import('@/lib/db');
const { reviewLogs, users } = await import('@/lib/db/schema');
const { and, count, eq, gt } = await import('drizzle-orm');

/**
 * Прогон пути переоптимизации весов FSRS целиком, не дожидаясь двух сотен
 * настоящих повторений: зовёт cron-эндпоинт с пониженным порогом и печатает,
 * что изменилось.
 *
 * Чего скрипт НЕ делает — не подсовывает в базу выдуманные логи повторений.
 * Это напрашивалось (порог набирается мгновенно), но испортило бы ровно те
 * данные, ради достоверности которых всё и затевается: `fsrs-optimizer` считает
 * персональные веса по журналу, и подмешанные строки увели бы расписание
 * повторений в сторону от настоящей памяти. Проверять надо механизм, а не
 * подгонять данные под него.
 *
 * Сервер должен быть запущен (`npm run dev`).
 *
 * Использование:
 *   npm run fsrs:force-optimize
 *   npx tsx scripts/force-fsrs-optimize.ts --threshold=5 --url=http://localhost:3000
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const baseUrl = argValue('url') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const threshold = Number(argValue('threshold') ?? 1);

if (!Number.isInteger(threshold) || threshold <= 0) {
  console.error('--threshold должен быть целым положительным числом.');
  process.exit(1);
}

const owner = await db.query.users.findFirst();
if (!owner) {
  console.error('Пользователь не найден — база пуста.');
  process.exit(1);
}

const since = owner.preferences.fsrsWeightsUpdatedAt
  ? new Date(owner.preferences.fsrsWeightsUpdatedAt)
  : new Date(0);

const [row] = await db
  .select({ n: count() })
  .from(reviewLogs)
  .where(and(eq(reviewLogs.userId, owner.id), gt(reviewLogs.reviewedAt, since)));

console.log('До вызова:');
console.log(`  настоящих логов повторений с последней подгонки: ${row?.n ?? 0}`);
console.log(`  fsrsOptimizationReady: ${owner.preferences.fsrsOptimizationReady ?? false}`);
console.log(`  персональные веса: ${owner.preferences.fsrsWeights ? 'заданы' : 'по умолчанию'}`);
console.log(`\nВызываю ${baseUrl}/api/cron/fsrs-optimization-check?threshold=${threshold}`);

const headers: Record<string, string> = {};
// Секрет нужен, только если он задан: без него эндпоинт вне production открыт.
if (process.env.CRON_SECRET) headers.Authorization = `Bearer ${process.env.CRON_SECRET}`;

let response: Response;
try {
  response = await fetch(`${baseUrl}/api/cron/fsrs-optimization-check?threshold=${threshold}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
} catch (error) {
  console.error(
    `Запрос не удался: ${error instanceof Error ? error.message : String(error)}\n` +
      'Сервер запущен? `npm run dev` в соседнем терминале.',
  );
  process.exit(1);
}

console.log(`HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);

const after = await db.query.users.findFirst({ where: eq(users.id, owner.id), columns: { preferences: true } });
const readyNow = after?.preferences.fsrsOptimizationReady ?? false;

console.log(`\nПосле вызова fsrsOptimizationReady: ${readyNow}`);
if (readyNow) {
  console.log(
    'Флаг взведён. Дальше вручную: выгрузить журнал повторений, посчитать веса\n' +
      'через Python-пакет fsrs-optimizer и применить их:\n' +
      '  npm run apply-fsrs-weights -- ./weights.json',
  );
} else {
  console.log('Флаг не взведён — логов повторений меньше порога.');
}

process.exit(0);
