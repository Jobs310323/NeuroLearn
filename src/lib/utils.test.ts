import { describe, expect, it } from 'vitest';

import { formatDueDate, formatDuration, slugify } from './utils';

describe('slugify', () => {
  it('транслитерирует кириллицу', () => {
    expect(slugify('Синаптическая пластичность')).toBe('sinapticheskaya-plastichnost');
  });

  it('схлопывает разделители и обрезает края', () => {
    expect(slugify('  Type — Safety!!  ')).toBe('type-safety');
  });

  it('не возвращает пустую строку', () => {
    expect(slugify('!!!')).toBe('node');
  });

  it('ограничивает длину', () => {
    expect(slugify('a'.repeat(200)).length).toBe(60);
  });
});

describe('formatDuration', () => {
  it.each([
    [45, '45 с'],
    [90, '1 мин'],
    [3600, '1 ч'],
    [5400, '1 ч 30 мин'],
  ])('%i секунд -> %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe('formatDueDate', () => {
  const now = new Date('2026-08-03T12:00:00Z');

  it('распознаёт сегодня и завтра', () => {
    expect(formatDueDate(new Date('2026-08-03T18:00:00Z'), now)).toBe('сегодня');
    expect(formatDueDate(new Date('2026-08-04T14:00:00Z'), now)).toBe('завтра');
  });

  it('показывает просрочку', () => {
    expect(formatDueDate(new Date('2026-08-01T12:00:00Z'), now)).toBe('просрочено на 2 дн.');
  });

  it('переходит на месяцы для дальних сроков', () => {
    expect(formatDueDate(new Date('2026-10-02T12:00:00Z'), now)).toBe('через 2 мес.');
  });
});
