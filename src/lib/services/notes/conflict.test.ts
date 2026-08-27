import { describe, expect, it } from 'vitest';

import { conflictCopyTitle, decideNoteWrite } from './conflict';

describe('decideNoteWrite', () => {
  it('версии совпали — обычная запись с инкрементом', () => {
    expect(
      decideNoteWrite({
        baseVersion: 3,
        serverVersion: 3,
        serverContentMd: 'старое',
        incomingContentMd: 'новое',
      }),
    ).toEqual({ kind: 'apply', nextVersion: 4 });
  });

  it('версия отстала и текст разошёлся — конфликт, а не перезапись', () => {
    expect(
      decideNoteWrite({
        baseVersion: 2,
        serverVersion: 5,
        serverContentMd: 'правка с телефона',
        incomingContentMd: 'правка с ноутбука',
      }),
    ).toEqual({ kind: 'conflict', serverVersion: 5 });
  });

  it('повторная отправка того же текста не плодит копий', () => {
    // Офлайн-очередь повторяет запрос, не получив ответа: правка уже доехала.
    expect(
      decideNoteWrite({
        baseVersion: 2,
        serverVersion: 3,
        serverContentMd: 'один и тот же текст',
        incomingContentMd: 'один и тот же текст',
      }),
    ).toEqual({ kind: 'already_applied', serverVersion: 3 });
  });

  it('разные переводы строк и хвостовые пробелы — не расхождение', () => {
    expect(
      decideNoteWrite({
        baseVersion: 1,
        serverVersion: 2,
        serverContentMd: 'строка\r\nвторая   \r\n',
        incomingContentMd: 'строка\nвторая\n',
      }).kind,
    ).toBe('already_applied');
  });

  it('версия впереди серверной (испорченный клиент) — тоже конфликт, не запись', () => {
    expect(
      decideNoteWrite({
        baseVersion: 9,
        serverVersion: 4,
        serverContentMd: 'a',
        incomingContentMd: 'b',
      }).kind,
    ).toBe('conflict');
  });
});

describe('conflictCopyTitle', () => {
  it('в заголовке есть дата — иначе копии неразличимы', () => {
    const title = conflictCopyTitle('Интерливинг', new Date('2026-03-04T10:20:00Z'), 'ru-RU');
    expect(title).toContain('Интерливинг');
    expect(title).toContain('конфликтная копия');
    expect(title).toMatch(/\d{2}\.\d{2}/);
  });

  it('заметка без названия получает понятную заглушку', () => {
    expect(conflictCopyTitle(null, new Date('2026-03-04T10:20:00Z'))).toContain('Без названия');
    expect(conflictCopyTitle('   ', new Date('2026-03-04T10:20:00Z'))).toContain('Без названия');
  });
});
