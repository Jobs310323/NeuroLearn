import { describe, expect, it } from 'vitest';

import { buildIcs, escapeIcsText, foldIcsLine, formatIcsDate } from './ics';

/**
 * Ошибки формата iCalendar не проявляются исключением: календарь просто молча
 * не показывает события. Поэтому проверяется буква стандарта, а не «работает
 * ли примерно».
 */

describe('formatIcsDate', () => {
  it('UTC без разделителей', () => {
    expect(formatIcsDate(new Date('2026-06-01T09:30:00Z'))).toBe('20260601T093000Z');
  });
});

describe('escapeIcsText', () => {
  it('экранирует запятую, точку с запятой и перевод строки', () => {
    expect(escapeIcsText('a,b;c\nd')).toBe('a\\,b\\;c\\nd');
  });

  it('обратный слэш экранируется первым, а не после остальных', () => {
    // Если бы слэш обрабатывался последним, он экранировал бы уже добавленные.
    expect(escapeIcsText('a\\,b')).toBe('a\\\\\\,b');
  });

  it('CRLF внутри текста тоже сворачивается в \\n', () => {
    expect(escapeIcsText('a\r\nb')).toBe('a\\nb');
  });
});

describe('foldIcsLine', () => {
  it('короткая строка не трогается', () => {
    expect(foldIcsLine('SUMMARY:коротко')).toBe('SUMMARY:коротко');
  });

  it('длина считается в байтах: кириллица занимает по два', () => {
    // 60 кириллических символов — это 120 байт, свёртка обязана произойти,
    // хотя символов меньше 75.
    const line = `SUMMARY:${'я'.repeat(60)}`;
    const folded = foldIcsLine(line);
    expect(folded).toContain('\r\n ');

    const encoder = new TextEncoder();
    for (const part of folded.split('\r\n')) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    }
  });

  it('продолжения начинаются с пробела', () => {
    const folded = foldIcsLine('X'.repeat(200));
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts.slice(1)) expect(part.startsWith(' ')).toBe(true);
  });

  it('символ не разрезается пополам между строками', () => {
    const folded = foldIcsLine(`SUMMARY:${'ё'.repeat(80)}`);
    // Если бы резали по байтам вслепую, получились бы битые последовательности.
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'ё'.repeat(80)}`);
  });
});

describe('buildIcs', () => {
  const event = {
    uid: 'node-1@neurolearn',
    start: new Date('2026-06-01T09:00:00Z'),
    durationMinutes: 20,
    summary: 'Повторение: Интерливинг',
    description: 'Прочность 62, срок подошёл',
    url: 'https://example.com/paths/1',
  };

  it('валидная оболочка календаря', () => {
    const ics = buildIcs({ name: 'NeuroLearn', events: [event], now: new Date('2026-05-30T00:00:00Z') });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
  });

  it('строки разделены CRLF: на LF часть клиентов показывает пустой календарь', () => {
    const ics = buildIcs({ name: 'NeuroLearn', events: [event] });
    expect(ics.split('\r\n').length).toBeGreaterThan(10);
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it('событие содержит начало, конец и напоминание', () => {
    const ics = buildIcs({ name: 'NeuroLearn', events: [event] });
    expect(ics).toContain('DTSTART:20260601T090000Z');
    expect(ics).toContain('DTEND:20260601T092000Z');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT15M');
  });

  it('каждый BEGIN закрыт своим END', () => {
    const ics = buildIcs({ name: 'NeuroLearn', events: [event, { ...event, uid: 'node-2' }] });
    const count = (needle: string) => ics.split(needle).length - 1;
    expect(count('BEGIN:VEVENT')).toBe(count('END:VEVENT'));
    expect(count('BEGIN:VALARM')).toBe(count('END:VALARM'));
    expect(count('BEGIN:VEVENT')).toBe(2);
  });

  it('пустой календарь валиден — у человека может не быть повторений', () => {
    const ics = buildIcs({ name: 'NeuroLearn', events: [] });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('запятая в названии узла не разрывает поле', () => {
    const ics = buildIcs({
      name: 'NeuroLearn',
      events: [{ ...event, summary: 'Повторение: списки, кортежи' }],
    });
    expect(ics).toContain('списки\\, кортежи');
  });
});
