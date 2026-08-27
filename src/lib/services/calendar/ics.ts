/**
 * Календарь повторений в формате iCalendar (RFC 5545).
 *
 * Фаза 1 из плана: подписка по ссылке, без OAuth. Человек добавляет
 * `webcal://…` в свой календарь один раз, дальше приложение только отдаёт
 * файл. Синхронизация через Google/Outlook API (Фаза 2) требует OAuth-клиента
 * и согласия владельца — до этого решения работает подписка, которая
 * не требует ни того, ни другого.
 *
 * Сборка — чистая функция. Формат придирчив к мелочам (CRLF, свёртка длинных
 * строк, экранирование запятых), а ошибки в нём проявляются не исключением, а
 * тем, что календарь молча не показывает события.
 */

export type CalendarEvent = {
  uid: string;
  start: Date;
  /** Длительность в минутах. Повторение — не встреча, но нулевое событие часть календарей прячет. */
  durationMinutes: number;
  summary: string;
  description?: string;
  url?: string;
};

/** Формат UTC-времени в iCalendar: `20260601T090000Z`. */
export function formatIcsDate(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * Экранирование по RFC 5545 §3.3.11. Обратный слэш обязан идти первым:
 * иначе экранируются уже добавленные слэши, и текст ломается.
 */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Свёртка длинных строк: RFC 5545 требует не длиннее 75 октетов, продолжение
 * начинается с пробела. Длина считается в БАЙТАХ, а не в символах — кириллица
 * в UTF-8 занимает два байта, и посимвольная свёртка давала бы строки вдвое
 * длиннее допустимого. Часть клиентов на этом просто теряет событие.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    // Первая строка — 75 байт, продолжения на байт короче из-за ведущего пробела.
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current) parts.push(current);

  return parts.join('\r\n ');
}

export function buildIcs(params: {
  name: string;
  events: CalendarEvent[];
  now?: Date;
}): string {
  const stamp = formatIcsDate(params.now ?? new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NeuroLearn//Review Schedule//RU',
    'CALSCALE:GREGORIAN',
    // Подсказка клиенту, как часто перечитывать ленту. Расписание меняется
    // после каждой сессии, но чаще раза в час обновляться незачем.
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    `X-WR-CALNAME:${escapeIcsText(params.name)}`,
    'METHOD:PUBLISH',
  ];

  for (const event of params.events) {
    const end = new Date(event.start.getTime() + event.durationMinutes * 60_000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatIcsDate(event.start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
      ...(event.url ? [`URL:${escapeIcsText(event.url)}`] : []),
      // Напоминание за 15 минут: повторение с точностью до часа бессмысленно
      // будить заранее, а без напоминания вовсе календарь бесполезен.
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      `DESCRIPTION:${escapeIcsText(event.summary)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  // CRLF обязателен по стандарту; часть клиентов на LF молча показывает
  // пустой календарь.
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
