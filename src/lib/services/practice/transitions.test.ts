import { describe, expect, it } from 'vitest';

import { nextNodeStatus, type TransitionFacts } from './transitions';

function facts(overrides: Partial<TransitionFacts> = {}): TransitionFacts {
  return {
    hasAnyResponse: false,
    hasPreAssessmentResponse: false,
    responseCount: 0,
    accuracy: 0,
    knowledgeStrength: 0,
    hasPostModuleReflection: false,
    distinctPracticeDays: 0,
    automaticityIndex: 0,
    responseTimeConsistent: false,
    automaticityDistinctDays: 0,
    successfulLongReviews: 0,
    interleavedAccuracy: null,
    cardDuePast: false,
    hasGapFromProjectDefense: false,
    ...overrides,
  };
}

describe('nextNodeStatus', () => {
  it('not_started -> in_progress после первого ответа на pre_assessment', () => {
    expect(nextNodeStatus('not_started', facts({ hasPreAssessmentResponse: true }))).toBe('in_progress');
  });

  it('not_started остаётся, пока pre_assessment не пройден', () => {
    expect(nextNodeStatus('not_started', facts())).toBe('not_started');
  });

  it('in_progress -> has_gaps при точности < 0.5 на >= 6 ответах', () => {
    const status = nextNodeStatus('in_progress', facts({ responseCount: 6, accuracy: 0.3 }));
    expect(status).toBe('has_gaps');
  });

  it('in_progress не переходит в has_gaps раньше 6 ответов', () => {
    const status = nextNodeStatus('in_progress', facts({ responseCount: 5, accuracy: 0.1 }));
    expect(status).toBe('in_progress');
  });

  it('in_progress -> mastered требует силу знания, рефлексию И разные дни', () => {
    expect(
      nextNodeStatus(
        'in_progress',
        facts({ knowledgeStrength: 85, hasPostModuleReflection: true, distinctPracticeDays: 2 }),
      ),
    ).toBe('mastered');
  });

  it('in_progress не переходит в mastered без рефлексии', () => {
    expect(
      nextNodeStatus(
        'in_progress',
        facts({ knowledgeStrength: 85, hasPostModuleReflection: false, distinctPracticeDays: 2 }),
      ),
    ).toBe('in_progress');
  });

  it('in_progress не переходит в mastered за один день', () => {
    expect(
      nextNodeStatus(
        'in_progress',
        facts({ knowledgeStrength: 85, hasPostModuleReflection: true, distinctPracticeDays: 1 }),
      ),
    ).toBe('in_progress');
  });

  it('mastered -> automated при автоматизме, длинных повторениях и точности в интерливинге', () => {
    const status = nextNodeStatus(
      'mastered',
      facts({
        automaticityIndex: 0.85,
        responseTimeConsistent: true,
        automaticityDistinctDays: 3,
        successfulLongReviews: 3,
        interleavedAccuracy: 0.95,
      }),
    );
    expect(status).toBe('automated');
  });

  it('mastered не переходит в automated без трёх разных дней, даже при устойчивом темпе', () => {
    const status = nextNodeStatus(
      'mastered',
      facts({
        automaticityIndex: 0.85,
        responseTimeConsistent: true,
        automaticityDistinctDays: 2,
        successfulLongReviews: 3,
        interleavedAccuracy: 0.95,
      }),
    );
    expect(status).toBe('mastered');
  });

  it('mastered не переходит в automated без устойчивого темпа, даже при высоком automaticityIndex', () => {
    const status = nextNodeStatus(
      'mastered',
      facts({
        automaticityIndex: 0.85,
        responseTimeConsistent: false,
        successfulLongReviews: 3,
        interleavedAccuracy: 0.95,
      }),
    );
    expect(status).toBe('mastered');
  });

  it('mastered -> needs_review, если карточка просрочена и до автоматизма не дотягивает', () => {
    expect(nextNodeStatus('mastered', facts({ cardDuePast: true }))).toBe('needs_review');
  });

  it('needs_review возвращается в mastered, когда due снова в будущем', () => {
    expect(nextNodeStatus('needs_review', facts({ cardDuePast: false }))).toBe('mastered');
  });

  it('mastered/automated -> has_gaps, если пробел вскрыт защитой проекта', () => {
    expect(nextNodeStatus('mastered', facts({ hasGapFromProjectDefense: true }))).toBe('has_gaps');
    expect(nextNodeStatus('automated', facts({ hasGapFromProjectDefense: true }))).toBe('has_gaps');
  });
});
