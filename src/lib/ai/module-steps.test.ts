import { describe, expect, it } from 'vitest';

import { moduleStepsDone, nextModuleStep } from './module-steps';
import { BLOCK_GROUP_A, BLOCK_GROUP_B } from './schemas';

/**
 * Правило «шаг выполнен = его результат в базе». Проверяется именно на
 * недособранных состояниях: ради них шаги и разделялись — после обрыва
 * генерация обязана доделывать недостающее, а не начинать заново.
 */

describe('moduleStepsDone', () => {
  it('пустой узел — не сделано ничего', () => {
    expect(moduleStepsDone([], 0)).toEqual([]);
    expect(nextModuleStep(moduleStepsDone([], 0))).toBe('blocks_a');
  });

  it('первая половина блоков — сделан первый шаг', () => {
    const done = moduleStepsDone([...BLOCK_GROUP_A], 0);
    expect(done).toEqual(['blocks_a']);
    expect(nextModuleStep(done)).toBe('blocks_b');
  });

  it('все блоки без заданий — остались задания', () => {
    const done = moduleStepsDone([...BLOCK_GROUP_A, ...BLOCK_GROUP_B], 0);
    expect(done).toEqual(['blocks_a', 'blocks_b']);
    expect(nextModuleStep(done)).toBe('assessments');
  });

  it('блоки и задания — делать нечего', () => {
    const done = moduleStepsDone([...BLOCK_GROUP_A, ...BLOCK_GROUP_B], 9);
    expect(done).toEqual(['blocks_a', 'blocks_b', 'assessments']);
    expect(nextModuleStep(done)).toBeNull();
  });

  it('неполная группа шагом не считается', () => {
    const done = moduleStepsDone(BLOCK_GROUP_A.slice(0, 4), 0);
    expect(done).toEqual([]);
    expect(nextModuleStep(done)).toBe('blocks_a');
  });

  it('вторая группа без первой не выдаёт первую за сделанную', () => {
    const done = moduleStepsDone([...BLOCK_GROUP_B], 0);
    expect(done).toEqual(['blocks_b']);
    // Первый невыполненный шаг — именно пропущенный, а не следующий по счёту.
    expect(nextModuleStep(done)).toBe('blocks_a');
  });

  it('дубликаты блоков не ломают подсчёт', () => {
    const done = moduleStepsDone([...BLOCK_GROUP_A, ...BLOCK_GROUP_A], 0);
    expect(done).toEqual(['blocks_a']);
  });
});
