import { describe, expect, it } from 'vitest';

import {
  RRF_K,
  contentHash,
  cosineSimilarity,
  fuseRrf,
  toRanked,
} from './hybrid-search';

describe('fuseRrf', () => {
  it('документ, найденный обоими поисками, поднимается выше', () => {
    // `both` вторая в обоих списках; `topFts` первая, но только в одном.
    const fused = fuseRrf(toRanked(['topFts', 'both']), toRanked(['topVec', 'both']));
    expect(fused[0]!.id).toBe('both');
    expect(fused[0]!.sources).toEqual(['fts', 'vector']);
  });

  it('оценки не сравниваются — только ранги', () => {
    // Оба списка длиной 1: вклад зависит только от позиции, а не от того,
    // насколько «уверен» был каждый поиск.
    const fused = fuseRrf(toRanked(['a']), toRanked(['b']));
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score);
  });

  it('ранги проставляются от единицы', () => {
    expect(toRanked(['a', 'b'])).toEqual([
      { id: 'a', rank: 1 },
      { id: 'b', rank: 2 },
    ]);
  });

  it('вклад считается по формуле 1/(k+rank)', () => {
    const fused = fuseRrf(toRanked(['a']), []);
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 1));
  });

  it('пустой векторный список не ломает выдачу — деградация в чистый FTS', () => {
    const fused = fuseRrf(toRanked(['a', 'b', 'c']), []);
    expect(fused.map((hit) => hit.id)).toEqual(['a', 'b', 'c']);
    expect(fused.every((hit) => hit.vectorRank === null)).toBe(true);
  });

  it('оба списка пусты — пустая выдача, а не исключение', () => {
    expect(fuseRrf([], [])).toEqual([]);
  });

  it('порядок детерминирован при равных оценках', () => {
    const first = fuseRrf(toRanked(['b', 'a']), toRanked(['a', 'b']));
    const second = fuseRrf(toRanked(['b', 'a']), toRanked(['a', 'b']));
    expect(first.map((h) => h.id)).toEqual(second.map((h) => h.id));
  });

  it('сохраняет исходные ранги для показа в интерфейсе', () => {
    const fused = fuseRrf(toRanked(['x', 'y']), toRanked(['y']));
    const y = fused.find((hit) => hit.id === 'y')!;
    expect(y.ftsRank).toBe(2);
    expect(y.vectorRank).toBe(1);
  });
});

describe('contentHash', () => {
  it('одинаковый текст — одинаковый хеш', () => {
    expect(contentHash('Тема', 'текст')).toBe(contentHash('Тема', 'текст'));
  });

  it('правка пробелов и переводов строк не запускает пересчёт вектора', () => {
    expect(contentHash('Тема', 'текст  здесь')).toBe(contentHash('Тема', 'текст здесь'));
    expect(contentHash('Тема', 'a\r\n\r\n\r\n\r\nb')).toBe(contentHash('Тема', 'a\n\nb'));
    expect(contentHash('Тема', ' текст ')).toBe(contentHash('Тема', 'текст'));
  });

  it('изменение смысла меняет хеш', () => {
    expect(contentHash('Тема', 'текст')).not.toBe(contentHash('Тема', 'другой текст'));
    expect(contentHash('Тема', 'текст')).not.toBe(contentHash('Другая тема', 'текст'));
  });

  it('заметка без заголовка хешируется без падения', () => {
    expect(contentHash(null, 'текст')).toHaveLength(8);
  });

  it('пустая заметка даёт стабильный хеш', () => {
    expect(contentHash(null, '')).toBe(contentHash('', ''));
  });
});

describe('cosineSimilarity', () => {
  it('одинаковые векторы — единица', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('ортогональные — ноль', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('противоположные — минус единица', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('длина вектора не влияет на близость, только направление', () => {
    expect(cosineSimilarity([1, 1], [10, 10])).toBeCloseTo(1);
  });

  it('несовпадающие размерности и нулевой вектор дают 0, а не NaN', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
