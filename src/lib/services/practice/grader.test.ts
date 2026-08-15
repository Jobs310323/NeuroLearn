import { describe, expect, it } from 'vitest';

import type { Assessment } from '@/lib/db/schema';

import { gradeResponse } from './grader';

function assessment(overrides: Partial<Assessment>): Assessment {
  return {
    id: 'a1',
    nodeId: 'n1',
    contentBlockId: null,
    type: 'mcq',
    cognitiveLevel: 'recall',
    prompt: 'q',
    payload: { kind: 'mcq', options: [] },
    correctAnswer: { kind: 'option_ids', ids: [] },
    explanation: null,
    socraticHints: [],
    feedbackMode: 'instant',
    instantFeedback: true,
    delayedFeedback: false,
    isPreAssessment: false,
    difficulty: 0.5,
    discrimination: null,
    targetResponseMs: null,
    variantGroupId: null,
    contextLabel: null,
    tags: [],
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('gradeResponse', () => {
  it('mcq: верный вариант — верно и полный балл', () => {
    const a = assessment({ correctAnswer: { kind: 'option_ids', ids: ['b'] } });
    expect(gradeResponse(a, { kind: 'option_ids', ids: ['b'] })).toEqual({
      isCorrect: true,
      partialScore: 1,
    });
  });

  it('mcq: неверный вариант — неверно, ноль баллов', () => {
    const a = assessment({ correctAnswer: { kind: 'option_ids', ids: ['b'] } });
    expect(gradeResponse(a, { kind: 'option_ids', ids: ['c'] })).toEqual({
      isCorrect: false,
      partialScore: 0,
    });
  });

  it('multi_select: частичное совпадение даёт частичный балл, но не isCorrect', () => {
    const a = assessment({ correctAnswer: { kind: 'option_ids', ids: ['a', 'b', 'c'] } });
    const result = gradeResponse(a, { kind: 'option_ids', ids: ['a', 'b'] });
    expect(result.isCorrect).toBe(false);
    expect(result.partialScore).toBeCloseTo(2 / 3);
  });

  it('multi_select: лишний неверный вариант снижает частичный балл', () => {
    const a = assessment({ correctAnswer: { kind: 'option_ids', ids: ['a', 'b'] } });
    const result = gradeResponse(a, { kind: 'option_ids', ids: ['a', 'b', 'c'] });
    expect(result.isCorrect).toBe(false);
    expect(result.partialScore).toBeCloseTo(0.5);
  });

  it('cloze: сравнение без учёта регистра по каждому пропуску', () => {
    const a = assessment({
      type: 'cloze',
      correctAnswer: { kind: 'blanks', byBlankId: { b1: ['Reach'] } },
    });
    expect(gradeResponse(a, { kind: 'blanks', byBlankId: { b1: 'reach' } }).isCorrect).toBe(true);
    expect(gradeResponse(a, { kind: 'blanks', byBlankId: { b1: 'impact' } }).isCorrect).toBe(false);
  });

  it('text: принимает любой из вариантов accepted, без учёта регистра', () => {
    const a = assessment({
      type: 'short_answer',
      correctAnswer: { kind: 'text', accepted: ['Reach, Impact, Confidence, Effort'], caseSensitive: false },
    });
    const result = gradeResponse(a, { kind: 'text', value: 'reach, impact, confidence, effort' });
    expect(result).toEqual({ isCorrect: true, partialScore: 1 });
  });

  it('text: caseSensitive=true требует точного совпадения регистра', () => {
    const a = assessment({
      type: 'short_answer',
      correctAnswer: { kind: 'text', accepted: ['RICE'], caseSensitive: true },
    });
    expect(gradeResponse(a, { kind: 'text', value: 'rice' }).isCorrect).toBe(false);
    expect(gradeResponse(a, { kind: 'text', value: 'RICE' }).isCorrect).toBe(true);
  });

  it('несовпадение типа ответа с типом эталона — неверно, без исключения', () => {
    const a = assessment({ correctAnswer: { kind: 'option_ids', ids: ['a'] } });
    expect(gradeResponse(a, { kind: 'text', value: 'a' })).toEqual({ isCorrect: false, partialScore: 0 });
  });
});
