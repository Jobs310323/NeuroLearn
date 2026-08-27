import { describe, expect, it } from 'vitest';

import { toTsQuery } from './search';

describe('toTsQuery', () => {
  it('каждое слово ищется по префиксу и обязательно', () => {
    expect(toTsQuery('интерл практика')).toBe('интерл:* & практика:*');
  });

  it('кавычки дают поиск фразой', () => {
    expect(toTsQuery('"разнесённая практика"')).toBe('разнесённая <-> практика');
  });

  it('фраза и отдельные слова сочетаются', () => {
    expect(toTsQuery('"рабочая память" объём')).toBe('рабочая <-> память & объём:*');
  });

  it('вырезает синтаксис tsquery — иначе Postgres падает на невалидном выражении', () => {
    expect(toTsQuery('a & b | !c')).toBe('a:* & b:* & c:*');
    expect(toTsQuery('(select)')).toBe('select:*');
    expect(toTsQuery("foo:*'")).toBe('foo:*');
  });

  it('работает с латиницей и испанскими диакритиками', () => {
    expect(toTsQuery('memoria espaciada')).toBe('memoria:* & espaciada:*');
    expect(toTsQuery('práctica')).toBe('práctica:*');
  });

  it('пустой запрос — null, а не выражение, ничего не находящее', () => {
    expect(toTsQuery('')).toBeNull();
    expect(toTsQuery('   ')).toBeNull();
    expect(toTsQuery('!!!')).toBeNull();
    expect(toTsQuery('""')).toBeNull();
  });
});
