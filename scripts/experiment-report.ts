import { config } from 'dotenv';
config({ path: '.env.local' });

const { enableEnvProxy } = await import('@/lib/net/proxy');
enableEnvProxy();

const { db } = await import('@/lib/db');
const { learningExperiments } = await import('@/lib/db/schema');
const { eq } = await import('drizzle-orm');
const { experimentReport } = await import('@/lib/db/queries/experiments');

/**
 * Честный отчёт по эксперименту (план, Фаза 3, п.3): размер выборки и
 * разброс, не один процент. При недостатке данных печатает «пока рано», а
 * не выбирает победителя — `readable` в `ExperimentReport` для этого и есть.
 *
 * Использование:
 *   npx tsx scripts/experiment-report.ts --id=<uuid>
 */

const args = process.argv.slice(2);
const id = args.find((a) => a.startsWith('--id='))?.split('=').slice(1).join('=');
if (!id) {
  console.error('Нужен идентификатор эксперимента: --id=<uuid>');
  process.exit(1);
}

const experiment = await db.query.learningExperiments.findFirst({ where: eq(learningExperiments.id, id) });
if (!experiment) {
  console.error(`Эксперимент ${id} не найден.`);
  process.exit(1);
}

const report = await experimentReport(id);
if (!report) {
  console.error('Не удалось построить отчёт.');
  process.exit(1);
}

console.log(`Эксперимент: ${experiment.hypothesis}`);
console.log(`Переменная: ${experiment.variable}, метрика: ${experiment.metric}, окно: ${experiment.windowDays} дней`);
console.log(`Статус: ${experiment.status}`);
console.log('');
console.log(`Ветка A: n=${report.armA.n}, точность=${report.armA.accuracy != null ? `${Math.round(report.armA.accuracy * 100)}%` : '—'}`);
console.log(`Ветка B: n=${report.armB.n}, точность=${report.armB.accuracy != null ? `${Math.round(report.armB.accuracy * 100)}%` : '—'}`);
console.log('');

if (!report.readable) {
  console.log('Пока рано: в одной из веток меньше 20 отложенных проверок. Число, а не вывод.');
} else if (report.armA.accuracy != null && report.armB.accuracy != null) {
  const diff = report.armA.accuracy - report.armB.accuracy;
  console.log(
    diff === 0
      ? 'Различия нет.'
      : `Ветка ${diff > 0 ? 'A' : 'B'} впереди на ${Math.round(Math.abs(diff) * 100)} п.п. — на такой выборке это ориентир, не строгий вывод.`,
  );
}

process.exit(0);
