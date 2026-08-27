import { DEFAULT_LOCALE, type Locale } from './config';

/**
 * Подстановка значений и выбор формы множественного числа.
 *
 * Плюрализация вынесена в код, а не в шаблон, потому что языки релиза
 * устроены по-разному: в русском три формы (задание / задания / заданий),
 * в английском и испанском — две. Шаблон вида `{count} заданий` был бы верен
 * ровно в одном языке из трёх, а «5 задание» в интерфейсе читается как
 * недоделка, даже если смысл понятен.
 *
 * Синтаксис: `{name}` — подстановка, `{count, plural, one{…} few{…} other{…}}`
 * — выбор формы. Подмножество ICU MessageFormat: достаточно для интерфейса и
 * помещается в один разбор без зависимости.
 */

export type MessageValues = Record<string, string | number>;

/** Категории CLDR, которые реально нужны трём языкам релиза. */
type PluralCategory = 'one' | 'few' | 'many' | 'other';

export function pluralCategory(count: number, locale: Locale): PluralCategory {
  const n = Math.abs(count);

  if (locale === 'ru') {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'one';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
    return 'many';
  }

  // en и es: одна форма для единицы, одна для всего остального.
  return n === 1 ? 'one' : 'other';
}

const PLURAL_START = /\{(\w+),\s*plural,\s*/g;

/**
 * Разбор идёт сканером со счётчиком скобок, а не регулярным выражением:
 * блок плюрализации содержит вложенные `{…}` формы, и регулярное выражение
 * либо останавливается на первой закрывающей скобке, либо заглатывает конец
 * строки. Оба случая дают на экране обрывок шаблона.
 */
function resolvePlurals(template: string, values: MessageValues, locale: Locale): string {
  let result = '';
  let cursor = 0;

  PLURAL_START.lastIndex = 0;
  let start: RegExpExecArray | null;

  while ((start = PLURAL_START.exec(template)) !== null) {
    const blockStart = start.index;
    if (blockStart < cursor) continue;

    // Ищем закрывающую скобку блока, считая вложенные.
    let depth = 1;
    let index = PLURAL_START.lastIndex;
    while (index < template.length && depth > 0) {
      if (template[index] === '{') depth += 1;
      else if (template[index] === '}') depth -= 1;
      index += 1;
    }
    if (depth !== 0) break; // Незакрытый блок — оставляем текст как есть.

    const body = template.slice(PLURAL_START.lastIndex, index - 1);
    const name = start[1]!;
    const count = Number(values[name]);

    result += template.slice(cursor, blockStart);
    result += Number.isFinite(count) ? selectForm(body, count, locale) : '';

    cursor = index;
    PLURAL_START.lastIndex = index;
  }

  return result + template.slice(cursor);
}

function selectForm(body: string, count: number, locale: Locale): string {
  const options = new Map<string, string>();
  const pattern = /(\w+)\s*\{([^}]*)\}/g;
  let form: RegExpExecArray | null;
  while ((form = pattern.exec(body)) !== null) options.set(form[1]!, form[2]!);

  const category = pluralCategory(count, locale);
  // Откат на `other`: если переводчик не задал форму, лучше показать
  // соседнюю, чем пустое место в предложении.
  const chosen =
    options.get(category) ?? options.get('other') ?? options.get('many') ?? '';

  // `#` — само число внутри выбранной формы (соглашение ICU).
  return chosen.replace(/#/g, String(count));
}

function interpolate(template: string, values: MessageValues): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

export function formatMessage(
  template: string,
  values: MessageValues = {},
  locale: Locale = DEFAULT_LOCALE,
): string {
  return interpolate(resolvePlurals(template, values, locale), values);
}

/** Плоский словарь: `hints.rest.message` → строка. */
export type Dictionary = Record<string, string>;

/**
 * Разворачивает вложенный JSON в плоские ключи. Вложенность удобна
 * переводчику, плоский ключ — коду.
 */
export function flatten(source: Record<string, unknown>, prefix = ''): Dictionary {
  const result: Dictionary = {};
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result[path] = value;
    else if (value && typeof value === 'object') {
      Object.assign(result, flatten(value as Record<string, unknown>, path));
    }
  }
  return result;
}

/**
 * Переводчик. Отсутствующий ключ возвращается как есть — это заметно на
 * экране и потому чинится, в отличие от пустой строки, которая выглядит как
 * задуманная пустота.
 */
export function createTranslator(dictionary: Dictionary, locale: Locale) {
  return (key: string, values?: MessageValues): string => {
    const template = dictionary[key];
    if (template === undefined) return key;
    return formatMessage(template, values, locale);
  };
}

export type Translator = ReturnType<typeof createTranslator>;
