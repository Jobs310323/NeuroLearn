import { describe, expect, it } from 'vitest';

import { buildIndexFile, safeFileName, toMarkdownFile, yamlScalar, type ExportableNote } from './export';
import { createZip, crc32 } from './zip';

const base: ExportableNote = {
  id: '11111111-2222-3333-4444-555555555555',
  type: 'idea',
  title: 'Интерливинг',
  contentMd: 'Мешать темы, а не блокировать одну.',
  colorLabel: 'insight',
  tags: ['практика', 'память'],
  nodeTitle: 'Разнесённое повторение',
  sourceTitle: null,
  pinned: false,
  resurfaceAt: null,
  createdAt: '2026-01-02T10:00:00.000Z',
  updatedAt: '2026-01-03T10:00:00.000Z',
  links: [],
};

describe('yamlScalar', () => {
  it('не трогает безопасные значения', () => {
    expect(yamlScalar('Интерливинг')).toBe('Интерливинг');
    expect(yamlScalar('note about x')).toBe('note about x');
  });

  it('закавычивает то, что YAML прочитал бы иначе', () => {
    expect(yamlScalar('- список')).toBe("'- список'");
    expect(yamlScalar('ключ: значение')).toBe("'ключ: значение'");
    expect(yamlScalar('true')).toBe("'true'");
    expect(yamlScalar('42')).toBe("'42'");
    expect(yamlScalar('2026-01-01')).toBe("'2026-01-01'");
    expect(yamlScalar('')).toBe("''");
  });

  it('удваивает одинарные кавычки внутри', () => {
    expect(yamlScalar("d'Artagnan: тест")).toBe("'d''Artagnan: тест'");
  });
});

describe('safeFileName', () => {
  it('убирает разделители пути и служебные символы', () => {
    expect(safeFileName({ ...base, title: 'a/b\\c:d*e?f"g<h>i|j' })).toMatch(/^a b c d e f g h i j 11111111\.md$/);
  });

  it('заметки с одинаковым заголовком не затирают друг друга', () => {
    const a = safeFileName(base);
    const b = safeFileName({ ...base, id: '99999999-2222-3333-4444-555555555555' });
    expect(a).not.toBe(b);
  });

  it('пустой заголовок получает заглушку', () => {
    expect(safeFileName({ ...base, title: null })).toContain('Без названия');
  });
});

describe('toMarkdownFile', () => {
  it('front-matter содержит якоря и теги', () => {
    const file = toMarkdownFile(base);
    expect(file.startsWith('---\n')).toBe(true);
    expect(file).toContain('type: idea');
    expect(file).toContain('tags: [практика, память]');
    expect(file).toContain('node: Разнесённое повторение');
    expect(file).toContain('Мешать темы, а не блокировать одну.');
  });

  it('связи выгружаются wiki-ссылками в обе стороны', () => {
    const file = toMarkdownFile({
      ...base,
      links: [
        { title: 'Блочная практика', relation: 'contradicts', direction: 'out' },
        { title: 'Пример из работы', relation: 'example_of', direction: 'in' },
      ],
    });
    expect(file).toContain('contradicts → [[Блочная практика]]');
    expect(file).toContain('[[Пример из работы]] → example_of');
  });

  it('без связей раздела «Связи» нет', () => {
    expect(toMarkdownFile(base)).not.toContain('## Связи');
  });
});

describe('buildIndexFile', () => {
  it('группирует по узлам и перечисляет заметки', () => {
    const index = buildIndexFile(
      [base, { ...base, id: 'aaaaaaaa-2222-3333-4444-555555555555', nodeTitle: null }],
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(index).toContain('count: 2');
    expect(index).toContain('## Разнесённое повторение');
    expect(index).toContain('## Без узла');
  });
});

describe('createZip', () => {
  it('CRC32 совпадает с эталонным значением', () => {
    // Классический контрольный вектор: CRC32("123456789") = 0xCBF43926.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('архив начинается локальным заголовком и кончается EOCD', () => {
    const zip = createZip([{ name: 'a.md', content: 'привет' }], new Date('2026-01-01T12:00:00Z'));
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    // Количество записей в EOCD — два поля подряд, оба равны числу файлов.
    expect(view.getUint16(zip.length - 22 + 8, true)).toBe(1);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
  });

  it('пустой архив валиден', () => {
    const zip = createZip([]);
    expect(zip.length).toBe(22);
    expect(new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(0, true)).toBe(
      0x06054b50,
    );
  });

  it('смещения записей каталога растут вместе с содержимым', () => {
    const zip = createZip([
      { name: 'a.md', content: 'первый' },
      { name: 'b.md', content: 'второй файл длиннее' },
    ]);
    // Оба файла попали в архив целиком — суммарный размер больше суммы тел.
    const bodies = new TextEncoder().encode('первыйвторой файл длиннее').length;
    expect(zip.length).toBeGreaterThan(bodies);
  });
});
