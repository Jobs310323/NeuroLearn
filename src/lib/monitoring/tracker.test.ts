import { describe, expect, it } from 'vitest';

import { buildEvent, parseDsn } from './tracker';

describe('parseDsn', () => {
  it('разбирает облачный DSN', () => {
    const dsn = parseDsn('https://abc123@o42.ingest.sentry.io/7654321');
    expect(dsn).toEqual({
      publicKey: 'abc123',
      host: 'o42.ingest.sentry.io',
      projectId: '7654321',
      storeUrl: 'https://o42.ingest.sentry.io/api/7654321/store/',
    });
  });

  it('сохраняет путь-префикс self-hosted приёмника', () => {
    const dsn = parseDsn('https://key@errors.example.com/tracking/12');
    expect(dsn?.storeUrl).toBe('https://errors.example.com/tracking/api/12/store/');
  });

  it('отклоняет DSN без ключа и без числового проекта', () => {
    expect(parseDsn('https://o42.ingest.sentry.io/7654321')).toBeNull();
    expect(parseDsn('https://key@host/project-name')).toBeNull();
    expect(parseDsn('не-ссылка')).toBeNull();
  });
});

describe('buildEvent', () => {
  it('кладёт Error в exception, а не в message', () => {
    const event = buildEvent({
      error: new TypeError('сломалось'),
      context: 'notes:create',
      now: new Date('2026-01-01T00:00:00Z'),
      eventId: '11111111-2222-3333-4444-555555555555',
    });

    expect(event.event_id).toBe('11111111222233334444555555555555');
    expect(event.exception?.values[0]).toMatchObject({ type: 'TypeError', value: 'сломалось' });
    expect(event.message).toBeUndefined();
    expect(event.tags.context).toBe('notes:create');
    expect(event.timestamp).toBe(new Date('2026-01-01T00:00:00Z').getTime() / 1000);
  });

  it('не-Error попадает в message', () => {
    const event = buildEvent({ error: 'строка вместо ошибки', context: 'x' });
    expect(event.message?.formatted).toBe('строка вместо ошибки');
    expect(event.exception).toBeUndefined();
  });

  it('кадры стека идут снизу вверх', () => {
    const error = new Error('e');
    error.stack = [
      'Error: e',
      '    at inner (/app/a.ts:10:5)',
      '    at outer (/app/b.ts:20:7)',
    ].join('\n');

    const frames = buildEvent({ error, context: 'x' }).exception?.values[0]?.stacktrace?.frames as
      | { function: string }[]
      | undefined;

    expect(frames?.map((f) => f.function)).toEqual(['outer', 'inner']);
  });
});
