import { describe, expect, it } from 'vitest';

import {
  PUSH_CATEGORIES,
  WEEKLY_BUDGET,
  budgetState,
  canSend,
  selectSendable,
  type SentRecord,
} from './budget';

const NOW = new Date('2026-06-08T12:00:00Z');
const DAY = 86_400_000;

function sent(category: SentRecord['category'], daysAgo: number): SentRecord {
  return { category, at: new Date(NOW.getTime() - daysAgo * DAY) };
}

describe('budgetState', () => {
  it('пустая история — весь бюджет доступен', () => {
    for (const state of budgetState([], NOW)) {
      expect(state.used).toBe(0);
      expect(state.remaining).toBe(WEEKLY_BUDGET[state.category]);
    }
  });

  it('окно скользящее: отправленное восемь дней назад не считается', () => {
    const state = budgetState([sent('node_weak', 8)], NOW).find(
      (item) => item.category === 'node_weak',
    )!;
    expect(state.used).toBe(0);
  });

  it('отправленное шесть дней назад ещё в окне', () => {
    const state = budgetState([sent('node_weak', 6)], NOW).find(
      (item) => item.category === 'node_weak',
    )!;
    expect(state.used).toBe(1);
  });

  it('категории считаются независимо', () => {
    const states = budgetState([sent('review_due', 1), sent('review_due', 2)], NOW);
    expect(states.find((s) => s.category === 'review_due')!.used).toBe(2);
    expect(states.find((s) => s.category === 'node_weak')!.used).toBe(0);
  });

  it('перерасход не даёт отрицательного остатка', () => {
    const history = Array.from({ length: 20 }, (_, i) => sent('node_weak', i % 7));
    const state = budgetState(history, NOW).find((item) => item.category === 'node_weak')!;
    expect(state.remaining).toBe(0);
  });
});

describe('canSend', () => {
  it('в пределах бюджета — можно', () => {
    expect(canSend('node_weak', [], NOW)).toBe(true);
  });

  it('исчерпанный бюджет закрывает категорию', () => {
    const history = Array.from({ length: WEEKLY_BUDGET.node_weak }, (_, i) =>
      sent('node_weak', i),
    );
    expect(canSend('node_weak', history, NOW)).toBe(false);
    // Другие категории при этом не страдают.
    expect(canSend('note_capsule', history, NOW)).toBe(true);
  });
});

describe('selectSendable', () => {
  const candidates = [
    { category: 'review_due' as const, payload: 'повторения' },
    { category: 'note_capsule' as const, payload: 'капсула' },
    { category: 'node_weak' as const, payload: 'узел просел' },
  ];

  it('капсула идёт первой: её дату человек назначил сам', () => {
    const selected = selectSendable(candidates, [], NOW);
    expect(selected[0]!.category).toBe('note_capsule');
  });

  it('одна категория — одно уведомление за прогон', () => {
    const many = [
      { category: 'node_weak' as const, payload: 'первый' },
      { category: 'node_weak' as const, payload: 'второй' },
    ];
    expect(selectSendable(many, [], NOW)).toHaveLength(1);
  });

  it('исчерпанная категория выпадает, остальные проходят', () => {
    const history = Array.from({ length: WEEKLY_BUDGET.review_due }, (_, i) =>
      sent('review_due', i % 7),
    );
    const selected = selectSendable(candidates, history, NOW);
    expect(selected.map((item) => item.category)).not.toContain('review_due');
    expect(selected.map((item) => item.category)).toContain('note_capsule');
  });

  it('нечего слать — пустой список, а не пустое уведомление', () => {
    expect(selectSendable([], [], NOW)).toEqual([]);
  });

  it('у каждой категории есть подпись и лимит', () => {
    for (const category of PUSH_CATEGORIES) {
      expect(WEEKLY_BUDGET[category]).toBeGreaterThan(0);
    }
  });
});
