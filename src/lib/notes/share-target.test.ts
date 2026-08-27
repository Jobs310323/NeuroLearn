import { describe, expect, it } from 'vitest';

import { parseShare } from './share-target';

describe('parseShare', () => {
  it('браузер: заголовок страницы и отдельный url', () => {
    const draft = parseShare({
      title: 'Про интерливинг',
      text: 'Короткое описание',
      url: 'https://example.com/a',
    });

    expect(draft.title).toBe('Про интерливинг');
    expect(draft.contentMd).toContain('Короткое описание');
    expect(draft.contentMd).toContain('[Источник](https://example.com/a)');
    expect(draft.type).toBe('quote');
  });

  it('мессенджер: ссылка пришла внутри text, поля url нет', () => {
    const draft = parseShare({ text: 'https://example.com/b' });
    expect(draft.contentMd).toBe('[Источник](https://example.com/b)');
    expect(draft.type).toBe('link_note');
    expect(draft.title).toBe('example.com');
  });

  it('ссылка внутри предложения вытаскивается, а само предложение остаётся', () => {
    const draft = parseShare({ text: 'смотри https://example.com/c про это' });
    expect(draft.contentMd).toContain('смотри https://example.com/c про это');
    expect(draft.contentMd).toContain('[Источник](https://example.com/c)');
  });

  it('читалка: цитата без ссылки — обычный перехват', () => {
    const draft = parseShare({ title: 'Книга', text: 'Практика важнее теории.' });
    expect(draft.type).toBe('capture');
    expect(draft.contentMd).toBe('Практика важнее теории.');
    expect(draft.title).toBe('Книга');
  });

  it('пустой ввод не роняет разбор', () => {
    expect(parseShare({})).toEqual({ title: null, contentMd: '', type: 'capture' });
  });

  it('текст никогда не теряется, даже если разбор ничего не узнал', () => {
    const weird = 'просто набор слов ### без структуры';
    expect(parseShare({ text: weird }).contentMd).toContain(weird);
  });

  it('битая ссылка не ломает заголовок', () => {
    const draft = parseShare({ text: '', url: 'http://' });
    expect(draft.title).toBeNull();
  });
});
