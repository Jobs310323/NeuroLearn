import { describe, expect, it } from 'vitest';

import {
  CONTRADICTION_ACCURACY,
  DEEP_LENGTH,
  MIN_REPS_FOR_CONTRADICTION,
  findContradictions,
  summarizeWeek,
  type NodeEvidence,
  type WeekNote,
} from './weekly';

function note(overrides: Partial<WeekNote> = {}): WeekNote {
  return {
    id: 'n1',
    type: 'capture',
    title: 'Заметка',
    contentMd: 'короткая мысль',
    nodeId: 'node-1',
    createdAt: new Date('2026-06-01T10:00:00Z'),
    linkCount: 0,
    confusionFlag: false,
    ...overrides,
  };
}

function evidence(overrides: Partial<NodeEvidence> = {}): NodeEvidence {
  return {
    nodeId: 'node-1',
    nodeTitle: 'Интерливинг',
    status: 'has_gaps',
    accuracyRate: 0.4,
    totalReps: 20,
    ...overrides,
  };
}

describe('summarizeWeek', () => {
  it('пустая неделя не делит на ноль', () => {
    expect(summarizeWeek([])).toMatchObject({ total: 0, connectedShare: 0, deepShare: 0 });
  });

  it('считает связность заметок', () => {
    const stats = summarizeWeek([
      note({ id: 'a', linkCount: 2 }),
      note({ id: 'b', linkCount: 0 }),
    ]);
    expect(stats.connectedShare).toBe(0.5);
  });

  it('глубокой считается длинная ИЛИ связанная заметка', () => {
    const stats = summarizeWeek([
      note({ id: 'long', contentMd: 'x'.repeat(DEEP_LENGTH) }),
      note({ id: 'linked', linkCount: 1 }),
      note({ id: 'fleeting' }),
    ]);
    expect(stats.deepShare).toBeCloseTo(2 / 3);
  });

  it('группирует по типам и считает пометки непонимания', () => {
    const stats = summarizeWeek([
      note({ id: 'a', type: 'idea' }),
      note({ id: 'b', type: 'idea' }),
      note({ id: 'c', type: 'question', confusionFlag: true }),
    ]);
    expect(stats.byType).toEqual({ idea: 2, question: 1 });
    expect(stats.confusionCount).toBe(1);
  });

  it('топ узлов упорядочен по количеству и детерминирован', () => {
    const stats = summarizeWeek([
      note({ id: 'a', nodeId: 'x' }),
      note({ id: 'b', nodeId: 'y' }),
      note({ id: 'c', nodeId: 'y' }),
    ]);
    expect(stats.topNodes[0]).toEqual({ nodeId: 'y', count: 2 });
  });

  it('заметки без узла в топ не попадают', () => {
    expect(summarizeWeek([note({ nodeId: null })]).topNodes).toEqual([]);
  });

  it('медиана длины считается по фактическому тексту', () => {
    const stats = summarizeWeek([
      note({ id: 'a', contentMd: 'x'.repeat(10) }),
      note({ id: 'b', contentMd: 'x'.repeat(30) }),
      note({ id: 'c', contentMd: 'x'.repeat(50) }),
    ]);
    expect(stats.medianLength).toBe(30);
  });
});

describe('findContradictions', () => {
  it('уверенное утверждение при низкой точности — противоречие', () => {
    const found = findContradictions(
      [note({ contentMd: 'Разобрался с интерливингом окончательно.' })],
      [evidence()],
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.evidence).toContain('40%');
    expect(found[0]!.nodeTitle).toBe('Интерливинг');
  });

  it('оговорка снимает уверенность: «кажется понял» — не утверждение', () => {
    expect(
      findContradictions([note({ contentMd: 'Кажется, понял, но не до конца.' })], [evidence()]),
    ).toEqual([]);
  });

  it('заметка без утверждения об уверенности не противоречит ничему', () => {
    expect(
      findContradictions([note({ contentMd: 'Прочитал главу про интерливинг.' })], [evidence()]),
    ).toEqual([]);
  });

  it('высокая точность — расхождения нет', () => {
    expect(
      findContradictions(
        [note({ contentMd: 'Разобрался.' })],
        [evidence({ accuracyRate: CONTRADICTION_ACCURACY })],
      ),
    ).toEqual([]);
  });

  it('мало повторений — говорить не о чем', () => {
    expect(
      findContradictions(
        [note({ contentMd: 'Разобрался.' })],
        [evidence({ totalReps: MIN_REPS_FOR_CONTRADICTION - 1 })],
      ),
    ).toEqual([]);
  });

  it('пометка «не понял» при низкой точности — согласие, а не противоречие', () => {
    expect(
      findContradictions(
        [note({ contentMd: 'Разобрался.', confusionFlag: true })],
        [evidence()],
      ),
    ).toEqual([]);
  });

  it('заметка без якоря на узел не проверяется — сравнивать не с чем', () => {
    expect(
      findContradictions([note({ contentMd: 'Разобрался.', nodeId: null })], [evidence()]),
    ).toEqual([]);
  });

  it('работает с английскими и испанскими формулировками', () => {
    expect(
      findContradictions([note({ contentMd: 'Finally understood this.' })], [evidence()]),
    ).toHaveLength(1);
    expect(
      findContradictions([note({ contentMd: 'Ahora lo entiendo bien.' })], [evidence()]),
    ).toHaveLength(1);
  });

  it('самые сильные расхождения идут первыми, порядок детерминирован', () => {
    const found = findContradictions(
      [
        note({ id: 'mild', nodeId: 'a', contentMd: 'Разобрался.' }),
        note({ id: 'severe', nodeId: 'b', contentMd: 'Разобрался.' }),
      ],
      [
        evidence({ nodeId: 'a', accuracyRate: 0.55 }),
        evidence({ nodeId: 'b', accuracyRate: 0.2 }),
      ],
    );
    expect(found.map((c) => c.noteId)).toEqual(['severe', 'mild']);
  });
});
