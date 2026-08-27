import { describe, expect, it } from 'vitest';

import {
  MIN_CELL_ATTEMPTS,
  bloomTypeHeatmap,
  buildCalendar,
  calendarIntensity,
  cognitiveRadar,
  dailyTrend,
  type ResponsePoint,
} from './insights';

function response(overrides: Partial<ResponsePoint> = {}): ResponsePoint {
  return {
    at: new Date('2026-06-01T10:00:00Z'),
    isCorrect: true,
    responseTimeMs: 10_000,
    confidenceLevel: 3,
    cognitiveLevel: 'apply',
    assessmentType: 'mcq',
    ...overrides,
  };
}

describe('dailyTrend', () => {
  it('усредняет по дням', () => {
    const trend = dailyTrend([
      { at: new Date('2026-06-01T09:00:00Z'), strength: 40 },
      { at: new Date('2026-06-01T20:00:00Z'), strength: 60 },
      { at: new Date('2026-06-02T09:00:00Z'), strength: 70 },
    ]);

    expect(trend).toEqual([
      { date: '2026-06-01', value: 50, samples: 2 },
      { date: '2026-06-02', value: 70, samples: 1 },
    ]);
  });

  it('пропущенные дни не достраиваются: линия через день без занятий врала бы о росте', () => {
    const trend = dailyTrend([
      { at: new Date('2026-06-01T09:00:00Z'), strength: 30 },
      { at: new Date('2026-06-05T09:00:00Z'), strength: 80 },
    ]);
    expect(trend.map((p) => p.date)).toEqual(['2026-06-01', '2026-06-05']);
  });

  it('пустой вход — пустой тренд', () => {
    expect(dailyTrend([])).toEqual([]);
  });
});

describe('bloomTypeHeatmap', () => {
  it('считает точность по клетке', () => {
    const cells = bloomTypeHeatmap([
      ...Array.from({ length: 4 }, () => response({ isCorrect: true })),
      ...Array.from({ length: 2 }, () => response({ isCorrect: false })),
    ]);

    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ level: 'apply', type: 'mcq', attempts: 6 });
    expect(cells[0]!.accuracy).toBeCloseTo(4 / 6);
  });

  it('клетка с малым числом попыток не получает точности', () => {
    const cells = bloomTypeHeatmap(
      Array.from({ length: MIN_CELL_ATTEMPTS - 1 }, () => response()),
    );
    expect(cells[0]!.accuracy).toBeNull();
    expect(cells[0]!.attempts).toBe(MIN_CELL_ATTEMPTS - 1);
  });

  it('ответы без уровня или типа пропускаются, а не сваливаются в общую клетку', () => {
    const cells = bloomTypeHeatmap([
      response({ cognitiveLevel: null }),
      response({ assessmentType: null }),
    ]);
    expect(cells).toEqual([]);
  });

  it('клетки упорядочены по уровню Блума, а не по алфавиту', () => {
    const cells = bloomTypeHeatmap([
      response({ cognitiveLevel: 'create' }),
      response({ cognitiveLevel: 'recall' }),
      response({ cognitiveLevel: 'analyze' }),
    ]);
    expect(cells.map((c) => c.level)).toEqual(['recall', 'analyze', 'create']);
  });
});

describe('cognitiveRadar', () => {
  const full = {
    accuracy: 0.8,
    calibrationGap: 0.1,
    automaticityIndex: 0.5,
    retentionIndex: 0.7,
    interleavingTolerance: 0.4,
    bloomCoverage: 0.6,
  };

  it('шесть осей с подписями и пояснениями', () => {
    const axes = cognitiveRadar(full);
    expect(axes).toHaveLength(6);
    for (const axis of axes) {
      expect(axis.label.length).toBeGreaterThan(0);
      expect(axis.hint.length).toBeGreaterThan(10);
    }
  });

  it('калибровка тем выше, чем ближе разрыв к нулю — в обе стороны', () => {
    const perfect = cognitiveRadar({ ...full, calibrationGap: 0 });
    const over = cognitiveRadar({ ...full, calibrationGap: 0.5 });
    const under = cognitiveRadar({ ...full, calibrationGap: -0.5 });

    const value = (axes: ReturnType<typeof cognitiveRadar>) =>
      axes.find((a) => a.key === 'calibration')!.value;

    expect(value(perfect)).toBe(1);
    expect(value(over)).toBeCloseTo(0.5);
    // Недооценка себя штрафуется так же, как переоценка: она мешает не
    // меньше, только иначе.
    expect(value(under)).toBeCloseTo(0.5);
  });

  it('ось без данных — null, а не ноль: ноль читался бы как «плохо»', () => {
    const axes = cognitiveRadar({
      accuracy: null,
      calibrationGap: null,
      automaticityIndex: null,
      retentionIndex: null,
      interleavingTolerance: null,
      bloomCoverage: null,
    });
    expect(axes.every((axis) => axis.value === null)).toBe(true);
  });

  it('значения за пределами 0..1 обрезаются, а не ломают радар', () => {
    const axes = cognitiveRadar({ ...full, accuracy: 1.4, automaticityIndex: -0.2 });
    expect(axes.find((a) => a.key === 'accuracy')!.value).toBe(1);
    expect(axes.find((a) => a.key === 'automaticity')!.value).toBe(0);
  });
});

describe('buildCalendar', () => {
  const from = new Date('2026-06-01T00:00:00Z');
  const to = new Date('2026-06-07T00:00:00Z');

  it('покрывает весь период, включая дни без занятий', () => {
    const days = buildCalendar([], from, to);
    expect(days).toHaveLength(7);
    expect(days.every((day) => day.sessions === 0)).toBe(true);
  });

  it('складывает сессии, ответы и минуты по дням', () => {
    const days = buildCalendar(
      [
        { startedAt: new Date('2026-06-02T10:00:00Z'), durationMs: 600_000, itemCount: 10 },
        { startedAt: new Date('2026-06-02T18:00:00Z'), durationMs: 300_000, itemCount: 5 },
      ],
      from,
      to,
    );

    const day = days.find((d) => d.date === '2026-06-02')!;
    expect(day).toMatchObject({ sessions: 2, responses: 15, minutes: 15 });
  });

  it('сессии за пределами периода игнорируются', () => {
    const days = buildCalendar(
      [{ startedAt: new Date('2026-05-01T10:00:00Z'), durationMs: 600_000, itemCount: 10 }],
      from,
      to,
    );
    expect(days.every((day) => day.sessions === 0)).toBe(true);
  });
});

describe('calendarIntensity', () => {
  const days = [
    { date: '2026-06-01', sessions: 1, responses: 4, minutes: 10 },
    { date: '2026-06-02', sessions: 0, responses: 0, minutes: 0 },
    { date: '2026-06-03', sessions: 3, responses: 20, minutes: 40 },
  ];

  it('шкала относительная — от самого плотного дня периода', () => {
    expect(calendarIntensity(days[2]!, days)).toBe(4);
    expect(calendarIntensity(days[0]!, days)).toBe(1);
  });

  it('день без практики — ноль, а не минимальная заливка', () => {
    expect(calendarIntensity(days[1]!, days)).toBe(0);
  });

  it('период без практики не делит на ноль', () => {
    const empty = [{ date: '2026-06-01', sessions: 0, responses: 0, minutes: 0 }];
    expect(calendarIntensity(empty[0]!, empty)).toBe(0);
  });

  it('любой день с практикой заметен: минимум первая ступень', () => {
    const skewed = [
      { date: 'a', sessions: 1, responses: 1, minutes: 1 },
      { date: 'b', sessions: 1, responses: 1000, minutes: 500 },
    ];
    expect(calendarIntensity(skewed[0]!, skewed)).toBe(1);
  });
});
