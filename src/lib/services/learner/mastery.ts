/**
 * Шкала мастерства. Не уровни и не очки: это подпись к тому, что уже
 * измерено (`node_progress.knowledge_strength`), чтобы число 0–100 было
 * читаемо без таблицы. Ни к чему не открывает доступ и ни с кем не
 * сравнивается — это ровно та граница, за которой начинается геймификация.
 *
 * Отдельным модулем от `queries/today.ts`: там чтение базы, здесь чистая
 * функция, и проверять её тестом не должно значить поднимать базу.
 */
export const MASTERY_SCALE = [
  { from: 0, label: 'Знакомство', description: 'Материал видели, извлекать из памяти пока трудно.' },
  { from: 25, label: 'Понимание', description: 'Отвечаете верно, но медленно и с усилием.' },
  { from: 50, label: 'Применение', description: 'Решаете типовые задачи, новые контексты сбивают.' },
  { from: 80, label: 'Мастерство', description: 'Верно и в новых контекстах; заполнена рефлексия.' },
  { from: 95, label: 'Автоматизм', description: 'Быстро и верно на разнесённых во времени повторениях.' },
] as const;

export type MasteryStep = { from: number; label: string; description: string };

export function masteryLabel(strength: number): MasteryStep {
  let current: MasteryStep = MASTERY_SCALE[0];
  for (const step of MASTERY_SCALE) {
    if (strength >= step.from) current = step;
  }
  return current;
}
