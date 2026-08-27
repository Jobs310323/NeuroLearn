/**
 * N-of-1 эксперимент — чистые функции: рандомизация по узлам и честный отчёт.
 *
 * PRD, Фаза 3: не угадывать, что работает для этого человека, а проверять.
 * Единица рандомизации — узел, а не сессия: если ветку менять от сессии к
 * сессии, обе перемешиваются внутри одного дня практики, и наблюдаемый
 * эффект нельзя приписать ни одной из них. Узел закрепляется за веткой один
 * раз и остаётся в ней весь эксперимент.
 */

export type Arm = 'a' | 'b';

/**
 * `random` — инъекция ради тестируемости (детерминированная последовательность
 * в тестах), в проде вызывается с `Math.random` по умолчанию.
 */
export function assignArms(nodeIds: string[], random: () => number = Math.random): Map<string, Arm> {
  const shuffled = [...nodeIds];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as string, shuffled[i] as string];
  }

  const half = Math.ceil(shuffled.length / 2);
  const assignment = new Map<string, Arm>();
  shuffled.forEach((id, index) => assignment.set(id, index < half ? 'a' : 'b'));
  return assignment;
}

export type ArmOutcome = { arm: Arm; rating: string; scheduledDays: number };

export type ExperimentReport = {
  armA: { n: number; accuracy: number | null };
  armB: { n: number; accuracy: number | null };
  readable: boolean;
};

/**
 * Ниже этого числа проверок в КАЖДОЙ ветке отчёт не считается читаемым:
 * различие на паре повторений — шум, не результат. Число не откалибровано
 * статистически (это не A/B-тест с расчётом мощности на популяции — здесь
 * n=1 человек и личные данные), это грубый порог «достаточно, чтобы не
 * стыдно было смотреть на процент».
 */
const MIN_READABLE_N = 20;

/**
 * Точность на ОТЛОЖЕННОЙ проверке — только повторения не раньше `windowDays`
 * после практики (иначе сравнение измеряло бы рабочую память, а не эффект
 * ветки на долговременное удержание).
 */
export function summarizeArmOutcomes(outcomes: ArmOutcome[], windowDays: number): ExperimentReport {
  const eligible = outcomes.filter((o) => o.scheduledDays >= windowDays);
  const byArm = (arm: Arm) => eligible.filter((o) => o.arm === arm);
  const accuracyOf = (rows: ArmOutcome[]) =>
    rows.length === 0 ? null : rows.filter((r) => r.rating !== 'again').length / rows.length;

  const a = byArm('a');
  const b = byArm('b');
  return {
    armA: { n: a.length, accuracy: accuracyOf(a) },
    armB: { n: b.length, accuracy: accuracyOf(b) },
    readable: a.length >= MIN_READABLE_N && b.length >= MIN_READABLE_N,
  };
}
