import en from '@/messages/en/common.json';
import es from '@/messages/es/common.json';
import ru from '@/messages/ru/common.json';

import { DEFAULT_LOCALE, type Locale } from './config';
import { createTranslator, flatten, type Dictionary, type Translator } from './translate';

/**
 * Словари всех языков собираются статически, а не подгружаются по запросу.
 *
 * Три языка интерфейса — это десятки килобайт текста, а динамическая загрузка
 * означала бы кадр без подписей при каждом переключении. Переключение без
 * перезагрузки — требование релиза, и оно проще всего выполняется тем, что
 * все словари уже в памяти.
 */

const RAW: Record<Locale, Record<string, unknown>> = { ru, en, es };

export const DICTIONARIES: Record<Locale, Dictionary> = {
  ru: flatten(RAW.ru),
  en: flatten(RAW.en),
  es: flatten(RAW.es),
};

/**
 * Недостающий в переводе ключ берётся из языка по умолчанию, а не
 * показывается сырым: полупереведённый экран лучше экрана с `hints.rest.message`
 * посреди предложения. Сам факт нехватки ловится тестом полноты словарей.
 */
export function getDictionary(locale: Locale): Dictionary {
  if (locale === DEFAULT_LOCALE) return DICTIONARIES[DEFAULT_LOCALE];
  return { ...DICTIONARIES[DEFAULT_LOCALE], ...DICTIONARIES[locale] };
}

export function getTranslator(locale: Locale): Translator {
  return createTranslator(getDictionary(locale), locale);
}
