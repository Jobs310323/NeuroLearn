/**
 * Языки интерфейса.
 *
 * Своя реализация вместо next-intl. Причина не в неприязни к библиотеке, а в
 * том, что от неё здесь нужен один процент возможностей: словарь, подстановки
 * и плюрализация. Взамен она приносит собственный роутинг, middleware и
 * требование переносить страницы в `[locale]/` — а глобального middleware в
 * проекте нет по инварианту авторизации, и заводить его ради переводов
 * значит менять правило безопасности ради удобства локализации.
 *
 * Язык хранится в `users.preferences.locale` и в cookie для мгновенного
 * переключения без перезагрузки.
 */

export const LOCALES = ['ru', 'en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ru';

export const LOCALE_NAMES: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
  es: 'Español',
};

/** Имя cookie. Читается и на сервере, и на клиенте — значение одно. */
export const LOCALE_COOKIE = 'neurolearn_locale';

export function isLocale(value: string | undefined | null): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Разбор `Accept-Language`. Нужен ровно один раз — для первого визита, пока
 * человек ничего не выбрал. Дальше решает его собственный выбор.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return {
        tag: (tag ?? '').trim().toLowerCase(),
        quality: q ? Number.parseFloat(q.split('=')[1] ?? '0') : 1,
      };
    })
    .filter((entry) => entry.tag.length > 0 && Number.isFinite(entry.quality))
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    const base = entry.tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
