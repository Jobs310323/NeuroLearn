import { describe, expect, it } from 'vitest';

import { assignArms, summarizeArmOutcomes, type ArmOutcome } from './experiments';

/** Детерминированный ГПСЧ для воспроизводимых тестов (не для прода). */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('assignArms', () => {
  it('назначает ветку каждому узлу', () => {
    const nodeIds = ['n1', 'n2', 'n3', 'n4', 'n5'];
    const assignment = assignArms(nodeIds, seededRandom(1));
    expect(assignment.size).toBe(nodeIds.length);
    for (const id of nodeIds) expect(['a', 'b']).toContain(assignment.get(id));
  });

  it('ветки примерно поровну', () => {
    const nodeIds = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const assignment = assignArms(nodeIds, seededRandom(42));
    const counts = { a: 0, b: 0 };
    for (const arm of assignment.values()) counts[arm] += 1;
    expect(Math.abs(counts.a - counts.b)).toBeLessThanOrEqual(1);
  });

  it('пустой список даёт пустое назначение', () => {
    expect(assignArms([], seededRandom(1)).size).toBe(0);
  });
});

describe('summarizeArmOutcomes', () => {
  function outcome(arm: 'a' | 'b', rating: string, scheduledDays = 10): ArmOutcome {
    return { arm, rating, scheduledDays };
  }

  it('повторения раньше windowDays не учитываются', () => {
    const outcomes = [outcome('a', 'good', 3), outcome('a', 'again', 3)];
    const report = summarizeArmOutcomes(outcomes, 7);
    expect(report.armA.n).toBe(0);
    expect(report.armA.accuracy).toBeNull();
  });

  it('считает точность как долю не-again среди отложенных проверок', () => {
    const outcomes = [
      outcome('a', 'good', 10),
      outcome('a', 'easy', 10),
      outcome('a', 'again', 10),
      outcome('a', 'good', 10),
    ];
    const report = summarizeArmOutcomes(outcomes, 7);
    expect(report.armA.n).toBe(4);
    expect(report.armA.accuracy).toBe(0.75);
  });

  it('readable=false при малой выборке хотя бы в одной ветке', () => {
    const outcomes = [outcome('a', 'good', 10), outcome('b', 'good', 10)];
    expect(summarizeArmOutcomes(outcomes, 7).readable).toBe(false);
  });

  it('readable=true, когда в обеих ветках достаточно наблюдений', () => {
    const outcomes = [
      ...Array.from({ length: 25 }, () => outcome('a', 'good', 10)),
      ...Array.from({ length: 25 }, () => outcome('b', 'good', 10)),
    ];
    expect(summarizeArmOutcomes(outcomes, 7).readable).toBe(true);
  });
});
