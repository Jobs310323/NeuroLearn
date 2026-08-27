import { config } from 'dotenv';
config({ path: '.env.local' });

const { enableEnvProxy } = await import('@/lib/net/proxy');
enableEnvProxy();

const { db } = await import('@/lib/db');
const { knowledgeNodes, learningPaths } = await import('@/lib/db/schema');
const { eq } = await import('drizzle-orm');
const { createExperiment, assignNodesToExperiment, startExperiment } = await import(
  '@/lib/db/queries/experiments'
);

/**
 * Первый эксперимент плана (Фаза 3, п.2): доля интерливинга 0.3 против 0.5.
 * Гипотеза — более лёгкая смесь (0.3) даёт не худшее отложенное удержание,
 * чем текущая (0.5), при заметно более комфортной практике.
 *
 * Рандомизирует узлы указанного пути по веткам A/B и запускает эксперимент.
 * Читаемый отчёт (`experimentReport`) появится не раньше, чем накопится
 * порядка сотни отложенных проверок (Фаза 3, п.2) — раньше срока запускать
 * бессмысленно, поэтому отчёт печатает другой путь, не этот скрипт.
 *
 * Использование:
 *   npx tsx scripts/create-experiment.ts --path="Продакт-менеджмент"
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const pathTitle = argValue('path');
if (!pathTitle) {
  console.error('Нужен путь: --path="Название пути"');
  process.exit(1);
}

const owner = await db.query.users.findFirst();
if (!owner) {
  console.error('Пользователь не найден — база пуста.');
  process.exit(1);
}

const path = await db.query.learningPaths.findFirst({
  where: eq(learningPaths.title, pathTitle),
});
if (!path) {
  console.error(`Путь «${pathTitle}» не найден.`);
  process.exit(1);
}

const nodes = await db
  .select({ id: knowledgeNodes.id })
  .from(knowledgeNodes)
  .where(eq(knowledgeNodes.pathId, path.id));

if (nodes.length < 4) {
  console.error(`В пути «${pathTitle}» всего ${nodes.length} узлов — рандомизация на пару узлов бессмысленна.`);
  process.exit(1);
}

const experiment = await createExperiment({
  userId: owner.id,
  hypothesis:
    'Доля интерливинга 0.3 даёт не худшее отложенное удержание (>= 7 дней), чем 0.5, при более комфортной практике.',
  variable: 'interleaveRatio',
  armA: { interleaveRatio: 0.3 },
  armB: { interleaveRatio: 0.5 },
  metric: 'delayed_accuracy',
  windowDays: 7,
});

await assignNodesToExperiment(
  experiment.id,
  nodes.map((n) => n.id),
);
await startExperiment(experiment.id);

console.log(`Эксперимент запущен: ${experiment.id}`);
console.log(`Путь: «${pathTitle}», узлов рандомизировано: ${nodes.length}`);
console.log('Ветка A (interleaveRatio=0.3) и ветка B (interleaveRatio=0.5) распределены случайно, поровну.');
console.log('Отчёт: npx tsx scripts/experiment-report.ts --id=' + experiment.id + ' — не раньше, чем накопятся отложенные проверки.');

process.exit(0);
