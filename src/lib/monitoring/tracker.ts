/**
 * Внешний трекинг ошибок (Sentry-класс).
 *
 * Почему свой транспорт, а не SDK: `@sentry/nextjs` тянет инструментацию
 * сборки и рантайма, а нужно ровно одно — доставить событие в приёмник.
 * Протокол Sentry Store API — это POST одного JSON с заголовком
 * `X-Sentry-Auth`; его поддерживают и Sentry, и GlitchTip, и self-hosted
 * приёмники. Так трекинг работает без новых зависимостей и без влияния на
 * сборку, а замена приёмника — это смена одной переменной окружения.
 *
 * Честное отключение (правило владельца из плана): DSN не задан — трекинг
 * выключен, но не притворяется работающим. `trackerStatus()` возвращает
 * причину, и она видна в настройках, а не только в логе.
 *
 * Ошибка доставки события никогда не влияет на обработку запроса: событие
 * уже записано в лог (`logger.ts`), трекер — второй канал, не первый.
 */

export type TrackerStatus =
  | { enabled: true; host: string; projectId: string; environment: string }
  | { enabled: false; reason: 'no_dsn' | 'bad_dsn' };

export type ParsedDsn = {
  publicKey: string;
  host: string;
  projectId: string;
  storeUrl: string;
};

/**
 * DSN: `https://<publicKey>@<host>/<projectId>` (возможен путь-префикс для
 * self-hosted: `https://key@host/prefix/42`). Чистая функция — разбор
 * проверяется тестом, а не догадкой по логам продакшена.
 */
export function parseDsn(dsn: string): ParsedDsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.username) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const projectId = segments.pop();
  if (!projectId || !/^\d+$/.test(projectId)) return null;

  const prefix = segments.length > 0 ? `/${segments.join('/')}` : '';

  return {
    publicKey: url.username,
    host: url.host,
    projectId,
    storeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/store/`,
  };
}

const dsnRaw = process.env.ERROR_TRACKING_DSN?.trim();
const parsed = dsnRaw ? parseDsn(dsnRaw) : null;

export function trackerStatus(): TrackerStatus {
  if (!dsnRaw) return { enabled: false, reason: 'no_dsn' };
  if (!parsed) return { enabled: false, reason: 'bad_dsn' };
  return {
    enabled: true,
    host: parsed.host,
    projectId: parsed.projectId,
    environment: environment(),
  };
}

function environment(): string {
  return process.env.ERROR_TRACKING_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
}

export type TrackedEvent = {
  event_id: string;
  timestamp: number;
  platform: 'node' | 'javascript';
  level: 'error' | 'warning' | 'info';
  environment: string;
  release?: string;
  logger: string;
  message?: { formatted: string };
  exception?: {
    values: { type: string; value: string; stacktrace?: { frames: unknown[] } }[];
  };
  tags: Record<string, string>;
  extra: Record<string, unknown>;
};

/**
 * Сборка события. Отдельно от отправки — чтобы форма события проверялась
 * тестом без сети.
 *
 * Персональные данные сюда не кладём: `extra` заполняет вызывающий код, а он
 * по всему проекту передаёт идентификаторы и счётчики, не тексты ответов
 * пользователя. Тело ответа — учебные данные человека, им не место во внешнем
 * сервисе.
 */
export function buildEvent(input: {
  error: unknown;
  context: string;
  level?: 'error' | 'warning' | 'info';
  extra?: Record<string, unknown>;
  eventId?: string;
  now?: Date;
}): TrackedEvent {
  const { error, context } = input;
  const isError = error instanceof Error;

  return {
    event_id: (input.eventId ?? crypto.randomUUID()).replace(/-/g, ''),
    timestamp: (input.now?.getTime() ?? Date.now()) / 1000,
    platform: typeof window === 'undefined' ? 'node' : 'javascript',
    level: input.level ?? 'error',
    environment: environment(),
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
    logger: 'neurolearn',
    message: isError ? undefined : { formatted: String(error) },
    exception: isError
      ? {
          values: [
            {
              type: error.name,
              value: error.message,
              stacktrace: error.stack
                ? { frames: parseStack(error.stack) }
                : undefined,
            },
          ],
        }
      : undefined,
    tags: { context },
    extra: input.extra ?? {},
  };
}

/**
 * Разбор стека в кадры Sentry. Формат V8: `    at fn (file:line:col)`.
 * Кадры идут снизу вверх — приёмник ожидает именно такой порядок
 * (последний кадр = место броска).
 */
function parseStack(stack: string): { function: string; filename: string; lineno: number; colno: number }[] {
  const frames: { function: string; filename: string; lineno: number; colno: number }[] = [];
  for (const line of stack.split('\n')) {
    const match = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    frames.push({
      function: match[1] ?? '<anonymous>',
      filename: match[2] ?? '',
      lineno: Number(match[3]),
      colno: Number(match[4]),
    });
  }
  return frames.reverse();
}

/**
 * Бюджет отправок. Каскад однотипных ошибок (упал провайдер — упали все
 * запросы к нему) не должен ни выесть квоту приёмника, ни превратиться в
 * собственный источник нагрузки.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
let windowStartedAt = 0;
let sentInWindow = 0;

function withinBudget(now: number): boolean {
  if (now - windowStartedAt > RATE_WINDOW_MS) {
    windowStartedAt = now;
    sentInWindow = 0;
  }
  sentInWindow += 1;
  return sentInWindow <= RATE_LIMIT;
}

/** Для тестов: сбросить окно бюджета между проверками. */
export function resetTrackerBudget(): void {
  windowStartedAt = 0;
  sentInWindow = 0;
}

/**
 * Отправка события. Не бросает и не ждётся вызывающим кодом (`void`).
 */
export function captureException(
  error: unknown,
  context: string,
  extra?: Record<string, unknown>,
): void {
  if (!parsed) return;
  if (!withinBudget(Date.now())) return;

  const event = buildEvent({ error, context, extra });
  void deliver(parsed, event);
}

async function deliver(dsn: ParsedDsn, event: TrackedEvent): Promise<void> {
  try {
    await fetch(dsn.storeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': [
          'Sentry sentry_version=7',
          'sentry_client=neurolearn/1.0',
          `sentry_key=${dsn.publicKey}`,
        ].join(', '),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Молчим намеренно: сама ошибка уже в логе, а провал доставки её копии
    // не должен порождать вторую ошибку и рекурсию логирования.
  }
}
