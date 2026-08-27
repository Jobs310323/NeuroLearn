'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './config';
import { getDictionary } from './dictionaries';
import { createTranslator, type MessageValues, type Translator } from './translate';

/**
 * Контекст языка.
 *
 * Переключение без перезагрузки — требование релиза, поэтому язык живёт в
 * состоянии React, а не в сегменте маршрута. Cookie ставится тем же
 * действием, чтобы серверный рендер следующей страницы совпал с тем, что
 * человек видит сейчас; предпочтение пользователя пишется в профиль отдельным
 * запросом и переживает смену устройства.
 */

type I18nValue = {
  locale: Locale;
  t: Translator;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    isLocale(initialLocale) ? initialLocale : DEFAULT_LOCALE,
  );

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    // `max-age` на год: язык — долгоживущее решение, а не сессионное.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    void fetch('/api/settings/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: next }),
      // Провал записи в профиль не должен мешать переключению: cookie уже
      // стоит, и на этом устройстве язык сменился.
    }).catch(() => {});
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ locale, t: createTranslator(getDictionary(locale), locale), setLocale }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Вне провайдера возвращается язык по умолчанию, а не исключение: компонент,
 * отрендеренный в тесте или в изоляции, должен показывать текст, а не падать.
 */
export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (context) return context;

  return {
    locale: DEFAULT_LOCALE,
    t: createTranslator(getDictionary(DEFAULT_LOCALE), DEFAULT_LOCALE),
    setLocale: () => {},
  };
}

export function useTranslations(): (key: string, values?: MessageValues) => string {
  return useI18n().t;
}
