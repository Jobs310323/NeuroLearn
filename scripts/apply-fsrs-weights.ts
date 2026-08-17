import { readFileSync } from 'node:fs';

import { config } from 'dotenv';
config({ path: '.env.local' });

const { db } = await import('@/lib/db');
const { users } = await import('@/lib/db/schema');
const { eq } = await import('drizzle-orm');

/**
 * Применяет веса, посчитанные офлайн через `fsrs-optimizer` (Python/PyTorch —
 * в проекте не встроен, ts-fsrs своего оптимизатора не содержит). Вход —
 * путь к JSON-файлу с массивом чисел (вывод `optimizer.compute_optimal_parameters()`).
 *
 * Использование: npx tsx scripts/apply-fsrs-weights.ts ./weights.json
 */

const WEIGHTS_COUNT = 21;

const path = process.argv[2];
if (!path) {
  console.error('Использование: tsx scripts/apply-fsrs-weights.ts <путь-к-weights.json>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(path, 'utf-8'));
// Конечность проверяется отдельно от типа: JSON не умеет записать NaN, но
// `1e999` разбирается в Infinity, а планировщик принимает такие веса молча
// и начинает считать даты повторений по битым коэффициентам.
if (
  !Array.isArray(raw) ||
  raw.length !== WEIGHTS_COUNT ||
  raw.some((n) => typeof n !== 'number' || !Number.isFinite(n))
) {
  console.error(`Ожидался JSON-массив из ${WEIGHTS_COUNT} чисел, получено: ${JSON.stringify(raw).slice(0, 200)}`);
  process.exit(1);
}
const weights: number[] = raw;

async function main() {
  const owner = await db.query.users.findFirst();
  if (!owner) throw new Error('Пользователь не найден.');

  await db
    .update(users)
    .set({
      preferences: {
        ...owner.preferences,
        fsrsWeights: weights,
        fsrsWeightsUpdatedAt: new Date().toISOString(),
        fsrsOptimizationReady: false,
      },
    })
    .where(eq(users.id, owner.id));

  console.log(`Веса применены (${weights.length} значений), fsrsOptimizationReady сброшен.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
