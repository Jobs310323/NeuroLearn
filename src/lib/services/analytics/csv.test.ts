import { describe, expect, it } from 'vitest';

import { escapeCsvField, toCsv } from './csv';

describe('escapeCsvField', () => {
  it('простые значения остаются без кавычек', () => {
    expect(escapeCsvField('интерливинг')).toBe('интерливинг');
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(true)).toBe('true');
  });

  it('запятая в тексте задания не съезжает в соседний столбец', () => {
    expect(escapeCsvField('да, но не всегда')).toBe('"да, но не всегда"');
  });

  it('кавычки удваиваются', () => {
    expect(escapeCsvField('он сказал "нет"')).toBe('"он сказал ""нет"""');
  });

  it('перевод строки в свободном ответе не рвёт строку файла', () => {
    expect(escapeCsvField('первая\nвторая')).toBe('"первая\nвторая"');
    expect(escapeCsvField('первая\r\nвторая')).toBe('"первая\r\nвторая"');
  });

  it('пустые значения — пустое поле, а не строка «null»', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('даты выгружаются в ISO — единственный формат, который читают все', () => {
    expect(escapeCsvField(new Date('2026-06-01T10:00:00Z'))).toBe('2026-06-01T10:00:00.000Z');
  });
});

describe('toCsv', () => {
  it('заголовок берётся из первой строки, разделитель — CRLF', () => {
    const csv = toCsv([
      { node: 'Интерливинг', strength: 80 },
      { node: 'Контрасты', strength: 45 },
    ]);
    expect(csv).toBe('node,strength\r\nИнтерливинг,80\r\nКонтрасты,45\r\n');
  });

  it('порядок столбцов можно задать явно', () => {
    const csv = toCsv([{ b: 2, a: 1 }], ['a', 'b']);
    expect(csv.split('\r\n')[0]).toBe('a,b');
  });

  it('отсутствующее в строке поле даёт пустую ячейку, а не сдвиг', () => {
    const csv = toCsv([{ a: 1, b: 2 }, { a: 3 }], ['a', 'b']);
    expect(csv).toBe('a,b\r\n1,2\r\n3,\r\n');
  });

  it('пустой набор данных — пустая строка, а не заголовок без строк', () => {
    expect(toCsv([])).toBe('');
  });
});
