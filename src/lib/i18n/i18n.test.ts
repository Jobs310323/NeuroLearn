import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, LOCALES, isLocale, negotiateLocale } from './config';
import { DICTIONARIES, getTranslator } from './dictionaries';
import { createTranslator, flatten, formatMessage, pluralCategory } from './translate';

describe('полнота словарей', () => {
  const reference = Object.keys(DICTIONARIES[DEFAULT_LOCALE]).sort();

  it.each(LOCALES.filter((l) => l !== DEFAULT_LOCALE))(
    'в «%s» есть все ключи языка по умолчанию',
    (locale) => {
      const missing = reference.filter((key) => !(key in DICTIONARIES[locale]));
      expect(missing).toEqual([]);
    },
  );

  it.each(LOCALES.filter((l) => l !== DEFAULT_LOCALE))(
    'в «%s» нет лишних ключей — иначе перевод расходится с интерфейсом',
    (locale) => {
      const extra = Object.keys(DICTIONARIES[locale]).filter(
        (key) => !(key in DICTIONARIES[DEFAULT_LOCALE]),
      );
      expect(extra).toEqual([]);
    },
  );

  it('тексты подсказок, тура и глоссария переведены на все языки', () => {
    // Требование релиза: эти три группы должны быть в локалях с первого дня.
    const prefixes = ['hints.', 'glossary.', 'map.', 'notes.'];
    for (const locale of LOCALES) {
      for (const prefix of prefixes) {
        const keys = Object.keys(DICTIONARIES[locale]).filter((k) => k.startsWith(prefix));
        expect(keys.length, `${locale} / ${prefix}`).toBeGreaterThan(0);
      }
    }
  });

  it('ни одна строка не пустая', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(DICTIONARIES[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('подстановки в переводах совпадают с исходными', () => {
    const placeholders = (template: string) =>
      [...template.matchAll(/\{(\w+)(?:,|\})/g)].map((m) => m[1]).sort();

    for (const locale of LOCALES) {
      if (locale === DEFAULT_LOCALE) continue;
      for (const key of Object.keys(DICTIONARIES[DEFAULT_LOCALE])) {
        const expected = placeholders(DICTIONARIES[DEFAULT_LOCALE][key]!);
        const actual = placeholders(DICTIONARIES[locale][key] ?? '');
        expect(actual, `${locale}:${key}`).toEqual(expected);
      }
    }
  });
});

describe('flatten', () => {
  it('разворачивает вложенность в плоские ключи', () => {
    expect(flatten({ a: { b: { c: 'x' } }, d: 'y' })).toEqual({ 'a.b.c': 'x', d: 'y' });
  });
});

describe('pluralCategory', () => {
  it('русские формы: 1, 2–4, 5+ и особый случай 11–14', () => {
    expect(pluralCategory(1, 'ru')).toBe('one');
    expect(pluralCategory(21, 'ru')).toBe('one');
    expect(pluralCategory(3, 'ru')).toBe('few');
    expect(pluralCategory(24, 'ru')).toBe('few');
    expect(pluralCategory(5, 'ru')).toBe('many');
    expect(pluralCategory(0, 'ru')).toBe('many');
    // 11 и 12 — исключение: «11 заданий», а не «11 задание».
    expect(pluralCategory(11, 'ru')).toBe('many');
    expect(pluralCategory(12, 'ru')).toBe('many');
  });

  it('английский и испанский: две формы', () => {
    expect(pluralCategory(1, 'en')).toBe('one');
    expect(pluralCategory(2, 'en')).toBe('other');
    expect(pluralCategory(1, 'es')).toBe('one');
    expect(pluralCategory(0, 'es')).toBe('other');
  });
});

describe('formatMessage', () => {
  it('подставляет значения', () => {
    expect(formatMessage('Уровень {level} из 5', { level: 4 })).toBe('Уровень 4 из 5');
  });

  it('выбирает форму множественного числа по языку', () => {
    const template = '{count, plural, one{# заметку} few{# заметки} many{# заметок}}';
    expect(formatMessage(template, { count: 1 }, 'ru')).toBe('1 заметку');
    expect(formatMessage(template, { count: 3 }, 'ru')).toBe('3 заметки');
    expect(formatMessage(template, { count: 7 }, 'ru')).toBe('7 заметок');
  });

  it('английский шаблон с двумя формами', () => {
    const template = '{count, plural, one{# note} other{# notes}}';
    expect(formatMessage(template, { count: 1 }, 'en')).toBe('1 note');
    expect(formatMessage(template, { count: 5 }, 'en')).toBe('5 notes');
  });

  it('неизвестная подстановка остаётся видимой, а не исчезает', () => {
    expect(formatMessage('привет {name}', {})).toBe('привет {name}');
  });

  it('отсутствующая форма откатывается на other', () => {
    expect(formatMessage('{n, plural, other{# штук}}', { n: 3 }, 'ru')).toBe('3 штук');
  });
});

describe('createTranslator', () => {
  it('отсутствующий ключ возвращается как есть — это заметно и потому чинится', () => {
    const t = createTranslator({}, 'ru');
    expect(t('hints.rest.message')).toBe('hints.rest.message');
  });

  it('реальные подсказки переводятся во всех языках', () => {
    for (const locale of LOCALES) {
      const t = getTranslator(locale);
      const text = t('hints.rest.message', { percent: 60, minutes: 2 });
      expect(text).not.toBe('hints.rest.message');
      expect(text).toContain('60');
    }
  });
});

describe('negotiateLocale', () => {
  it('выбирает язык по весу из Accept-Language', () => {
    expect(negotiateLocale('es-ES,es;q=0.9,en;q=0.8')).toBe('es');
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
    expect(negotiateLocale('ru-RU,ru;q=0.9,en;q=0.5')).toBe('ru');
  });

  it('незнакомый язык — умолчание', () => {
    expect(negotiateLocale('de-DE,de;q=0.9')).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale('')).toBe(DEFAULT_LOCALE);
  });

  it('вес учитывается, а не порядок', () => {
    expect(negotiateLocale('de;q=1.0,en;q=0.9,es;q=0.95')).toBe('es');
  });
});

describe('isLocale', () => {
  it('пропускает только поддерживаемые языки', () => {
    expect(isLocale('ru')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
