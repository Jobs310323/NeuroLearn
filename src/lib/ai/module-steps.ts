import { BLOCK_GROUP_A, BLOCK_GROUP_B } from './schemas';

/**
 * Шаги сборки модуля и правило, по которому шаг считается выполненным.
 *
 * Отдельный модуль без обращений к базе: правило нужно и серверу, и тестам,
 * а тянуть ради него подключение к Neon незачем.
 */
export const MODULE_STEPS = ['blocks_a', 'blocks_b', 'assessments'] as const;
export type ModuleStep = (typeof MODULE_STEPS)[number];

/**
 * Шаг выполнен, когда его результат лежит в базе. Отдельной таблицы прогресса
 * нет намеренно: она могла бы разойтись с содержимым узла, а содержимое узла
 * разойтись с самим собой не может.
 *
 * Половина группы шагом не считается. Неполный набор блоков ломает
 * канонический порядок, и переделать вызов целиком дешевле и честнее, чем
 * достраивать группу по одному блоку.
 */
export function moduleStepsDone(blockTypes: string[], assessmentCount: number): ModuleStep[] {
  const present = new Set(blockTypes);
  const done: ModuleStep[] = [];
  if (BLOCK_GROUP_A.every((type) => present.has(type))) done.push('blocks_a');
  if (BLOCK_GROUP_B.every((type) => present.has(type))) done.push('blocks_b');
  if (assessmentCount > 0) done.push('assessments');
  return done;
}

/** Первый невыполненный шаг; `null` — модуль собран целиком. */
export function nextModuleStep(done: ModuleStep[]): ModuleStep | null {
  return MODULE_STEPS.find((step) => !done.includes(step)) ?? null;
}
