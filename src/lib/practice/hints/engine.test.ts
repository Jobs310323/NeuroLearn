import { describe, expect, it } from 'vitest';

import { emptyHintContext, evaluateHints } from './engine';
import { HINT_RULES, HINT_RULE_BY_ID } from './rules';
import type { HintResponseSample, HintRuleId } from './types';

/**
 * Каждое правило проверяется в двух состояниях — срабатывает и НЕ
 * срабатывает. Второе важнее: подсказка, вылезающая не вовремя, дороже
 * подсказки, не вылезшей вовсе, потому что её начинают закрывать не читая,
 * и вместе с ней перестают читать все остальные.
 */

function answer(overrides: Partial<HintResponseSample> = {}): HintResponseSample {
  return {
    assessmentId: 'a1',
    nodeId: 'n1',
    isCorrect: true,
    responseTimeMs: 10_000,
    confidenceLevel: 3,
    jokLevel: 3,
    cognitiveLevel: 'apply',
    errorKind: null,
    flaggedConfusion: false,
    blockType: 'independent_practice',
    ...overrides,
  };
}

/** Сессия с ровным темпом: база для правила отдыха. */
function steadySession(count: number, ms = 10_000): HintResponseSample[] {
  return Array.from({ length: count }, (_, i) =>
    answer({ assessmentId: `a${i}`, responseTimeMs: ms }),
  );
}

function only(ruleId: HintRuleId) {
  return HINT_RULES.filter((rule) => rule.id === ruleId);
}

// --- rest_suggestion ----------------------------------------------------

describe('rest_suggestion', () => {
  it('срабатывает при росте медианы времени больше 40%', () => {
    const responses = [...steadySession(5, 10_000), ...steadySession(5, 18_000)];
    const hint = evaluateHints(
      emptyHintContext({ responses, currentIndex: responses.length - 1 }),
      only('rest_suggestion'),
    );

    expect(hint?.ruleId).toBe('rest_suggestion');
    expect(hint?.action).toEqual({ kind: 'start_rest_timer', seconds: 120 });
    expect(hint?.values.percent).toBe(80);
  });

  it('не срабатывает при ровном темпе', () => {
    const responses = steadySession(12, 10_000);
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: responses.length - 1 }),
        only('rest_suggestion'),
      ),
    ).toBeNull();
  });

  it('не срабатывает раньше восьмого задания, даже при сильном замедлении', () => {
    const responses = [...steadySession(5, 5_000), ...steadySession(2, 40_000)];
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: responses.length - 1 }),
        only('rest_suggestion'),
      ),
    ).toBeNull();
  });

  it('время неверных ответов не считается замедлением', () => {
    // Долгие ответы — все неверные: это колебания, а не потеря темпа.
    const responses = [
      ...steadySession(7, 10_000),
      ...Array.from({ length: 5 }, (_, i) =>
        answer({ assessmentId: `x${i}`, isCorrect: false, responseTimeMs: 60_000 }),
      ),
    ];
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: responses.length - 1 }),
        only('rest_suggestion'),
      ),
    ).toBeNull();
  });

  it('показывается не больше одного раза за сессию', () => {
    const responses = [...steadySession(5, 10_000), ...steadySession(8, 18_000)];
    const context = emptyHintContext({
      responses,
      currentIndex: responses.length - 1,
      shown: [{ ruleId: 'rest_suggestion', atIndex: 9 }],
    });
    expect(evaluateHints(context, only('rest_suggestion'))).toBeNull();
  });
});

// --- metacognitive_coaching ---------------------------------------------

describe('metacognitive_coaching', () => {
  it('срабатывает на «уверен и ошибся»', () => {
    const responses = [answer({ isCorrect: false, confidenceLevel: 5 })];
    const hint = evaluateHints(
      emptyHintContext({ responses, currentIndex: 0 }),
      only('metacognitive_coaching'),
    );
    expect(hint?.ruleId).toBe('metacognitive_coaching');
  });

  it('не срабатывает на ошибке при низкой уверенности — там модель себя верная', () => {
    const responses = [answer({ isCorrect: false, confidenceLevel: 2 })];
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: 0 }),
        only('metacognitive_coaching'),
      ),
    ).toBeNull();
  });

  it('не срабатывает на верном ответе при любой уверенности', () => {
    const responses = [answer({ isCorrect: true, confidenceLevel: 5 })];
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: 0 }),
        only('metacognitive_coaching'),
      ),
    ).toBeNull();
  });

  it('не срабатывает, если уверенность не собрана', () => {
    const responses = [answer({ isCorrect: false, confidenceLevel: null })];
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: 0 }),
        only('metacognitive_coaching'),
      ),
    ).toBeNull();
  });

  it('соблюдает cooldown в три задания', () => {
    const responses = Array.from({ length: 5 }, () =>
      answer({ isCorrect: false, confidenceLevel: 5 }),
    );
    const tooSoon = emptyHintContext({
      responses,
      currentIndex: 3,
      shown: [{ ruleId: 'metacognitive_coaching', atIndex: 1 }],
    });
    const farEnough = { ...tooSoon, currentIndex: 4 };

    expect(evaluateHints(tooSoon, only('metacognitive_coaching'))).toBeNull();
    expect(evaluateHints(farEnough, only('metacognitive_coaching'))?.ruleId).toBe(
      'metacognitive_coaching',
    );
  });
});

// --- contrast_mode_offer ------------------------------------------------

describe('contrast_mode_offer', () => {
  it('срабатывает на двух ошибках по соседним узлам', () => {
    const responses = [
      answer({ nodeId: 'n1', isCorrect: false }),
      answer({ nodeId: 'n9', isCorrect: true }),
      answer({ nodeId: 'n2', isCorrect: false }),
    ];
    const hint = evaluateHints(
      emptyHintContext({
        responses,
        currentIndex: 2,
        neighbours: { n2: ['n1'], n1: ['n2'] },
      }),
      only('contrast_mode_offer'),
    );

    expect(hint?.ruleId).toBe('contrast_mode_offer');
    expect(hint?.action).toEqual({ kind: 'open_contrast', nodeId: 'n2' });
  });

  it('не срабатывает, если ошибки по несвязанным узлам', () => {
    const responses = [
      answer({ nodeId: 'n1', isCorrect: false }),
      answer({ nodeId: 'n7', isCorrect: false }),
    ];
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: 1, neighbours: {} }),
        only('contrast_mode_offer'),
      ),
    ).toBeNull();
  });

  it('не срабатывает, если все ошибки careless — материалом это не лечится', () => {
    const responses = [
      answer({ nodeId: 'n1', isCorrect: false, errorKind: 'careless' }),
      answer({ nodeId: 'n1', isCorrect: false, errorKind: 'careless' }),
    ];
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: 1, neighbours: { n1: [] } }),
        only('contrast_mode_offer'),
      ),
    ).toBeNull();
  });

  it('ошибки за пределами окна из пяти заданий не учитываются', () => {
    const responses = [
      answer({ nodeId: 'n1', isCorrect: false }),
      ...Array.from({ length: 4 }, () => answer({ nodeId: 'n1', isCorrect: true })),
      answer({ nodeId: 'n1', isCorrect: false }),
    ];
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: 5, neighbours: { n1: [] } }),
        only('contrast_mode_offer'),
      ),
    ).toBeNull();
  });

  it('не срабатывает на верном последнем ответе', () => {
    const responses = [
      answer({ nodeId: 'n1', isCorrect: false }),
      answer({ nodeId: 'n1', isCorrect: false }),
      answer({ nodeId: 'n1', isCorrect: true }),
    ];
    expect(
      evaluateHints(
        emptyHintContext({ responses, currentIndex: 2, neighbours: { n1: [] } }),
        only('contrast_mode_offer'),
      ),
    ).toBeNull();
  });
});

// --- difficulty_indicator -----------------------------------------------

describe('difficulty_indicator', () => {
  it('срабатывает на уровне analyze и выше', () => {
    const hint = evaluateHints(
      emptyHintContext({ nextCognitiveLevel: 'analyze' }),
      only('difficulty_indicator'),
    );
    expect(hint?.ruleId).toBe('difficulty_indicator');
    expect(hint?.values.level).toBe(4);
  });

  it('не срабатывает на уровнях recall/understand/apply', () => {
    for (const level of ['recall', 'understand', 'apply']) {
      expect(
        evaluateHints(
          emptyHintContext({ nextCognitiveLevel: level }),
          only('difficulty_indicator'),
        ),
      ).toBeNull();
    }
  });

  it('без уровня не срабатывает — уровень не выдумывается', () => {
    expect(
      evaluateHints(emptyHintContext({ nextCognitiveLevel: null }), only('difficulty_indicator')),
    ).toBeNull();
  });
});

// --- capture_nudge ------------------------------------------------------

describe('capture_nudge', () => {
  it('срабатывает на флаге «не понял»', () => {
    const responses = [answer({ flaggedConfusion: true })];
    const hint = evaluateHints(
      emptyHintContext({ responses, currentIndex: 0 }),
      only('capture_nudge'),
    );
    expect(hint?.action).toMatchObject({ kind: 'capture_note', confusion: true });
  });

  it('срабатывает на проваленном задании переноса', () => {
    const responses = [answer({ isCorrect: false, blockType: 'transfer_task' })];
    const hint = evaluateHints(
      emptyHintContext({ responses, currentIndex: 0 }),
      only('capture_nudge'),
    );
    expect(hint?.messageKey).toBe('hints.capture.transfer');
  });

  it('не срабатывает на успешном задании переноса', () => {
    const responses = [answer({ isCorrect: true, blockType: 'transfer_task' })];
    expect(
      evaluateHints(emptyHintContext({ responses, currentIndex: 0 }), only('capture_nudge')),
    ).toBeNull();
  });

  it('не срабатывает на обычной ошибке без флага', () => {
    const responses = [answer({ isCorrect: false })];
    expect(
      evaluateHints(emptyHintContext({ responses, currentIndex: 0 }), only('capture_nudge')),
    ).toBeNull();
  });
});

// --- review_before_session ----------------------------------------------

describe('review_before_session', () => {
  it('показывается до первого задания, если есть живые заметки', () => {
    const hint = evaluateHints(
      emptyHintContext({
        currentIndex: -1,
        dueNotes: [
          { noteId: 'note-1', title: 'Интерливинг', nodeId: 'n1' },
          { noteId: 'note-2', title: 'Контрасты', nodeId: 'n1' },
          { noteId: 'note-3', title: 'Третья', nodeId: 'n1' },
        ],
      }),
      only('review_before_session'),
    );

    expect(hint?.ruleId).toBe('review_before_session');
    // Максимум две: больше — это уже чтение вместо практики.
    expect(hint?.values.count).toBe(2);
  });

  it('не показывается посреди сессии', () => {
    expect(
      evaluateHints(
        emptyHintContext({
          currentIndex: 3,
          dueNotes: [{ noteId: 'note-1', title: 'Х', nodeId: 'n1' }],
        }),
        only('review_before_session'),
      ),
    ).toBeNull();
  });

  it('без живых заметок не показывается', () => {
    expect(
      evaluateHints(emptyHintContext({ currentIndex: -1 }), only('review_before_session')),
    ).toBeNull();
  });
});

// --- движок -------------------------------------------------------------

describe('evaluateHints — общие правила движка', () => {
  const overconfidentMiss = emptyHintContext({
    responses: [answer({ isCorrect: false, confidenceLevel: 5 })],
    currentIndex: 0,
  });

  it('мастер-выключатель гасит всё', () => {
    expect(evaluateHints({ ...overconfidentMiss, enabled: false })).toBeNull();
  });

  it('отключённый тип не показывается, остальные продолжают работать', () => {
    expect(
      evaluateHints({ ...overconfidentMiss, disabledRules: ['metacognitive_coaching'] }),
    ).toBeNull();

    const withDifficulty = {
      ...overconfidentMiss,
      disabledRules: ['metacognitive_coaching'],
      nextCognitiveLevel: 'evaluate',
    };
    expect(evaluateHints(withDifficulty)?.ruleId).toBe('difficulty_indicator');
  });

  it('в pre_assessment подсказок нет: там задача измерить, а не помочь', () => {
    expect(evaluateHints({ ...overconfidentMiss, mode: 'pre_assessment' })).toBeNull();
  });

  it('при нескольких сработавших показывается одна — старшая по приоритету', () => {
    const context = emptyHintContext({
      responses: [answer({ isCorrect: false, confidenceLevel: 5, flaggedConfusion: true })],
      currentIndex: 0,
      nextCognitiveLevel: 'create',
    });

    const hint = evaluateHints(context);
    // metacognitive_coaching (80) старше capture_nudge (75) и difficulty (20).
    expect(hint?.ruleId).toBe('metacognitive_coaching');
  });

  it('результат не зависит от порядка правил на входе', () => {
    const context = emptyHintContext({
      responses: [answer({ isCorrect: false, confidenceLevel: 5, flaggedConfusion: true })],
      currentIndex: 0,
    });
    const forward = evaluateHints(context, HINT_RULES);
    const backward = evaluateHints(context, [...HINT_RULES].reverse());
    expect(forward?.ruleId).toBe(backward?.ruleId);
  });

  it('пустая сессия не даёт подсказок', () => {
    expect(evaluateHints(emptyHintContext())).toBeNull();
  });

  it('все шесть правил v1 зарегистрированы и уникальны по id', () => {
    expect(HINT_RULES).toHaveLength(6);
    expect(HINT_RULE_BY_ID.size).toBe(6);
  });

  it('у каждого правила задан лимит за сессию и приоритет', () => {
    for (const rule of HINT_RULES) {
      expect(rule.maxPerSession).toBeGreaterThan(0);
      expect(rule.priority).toBeGreaterThan(0);
    }
  });
});
