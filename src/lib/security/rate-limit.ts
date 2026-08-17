import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Лимит запросов к дорогим AI-роутам.
 *
 * Окно задаётся вызывающим: диалог с тьютором и генерация модуля стоят
 * несопоставимо разного (секунды против минут работы модели), поэтому одним
 * общим окном обойтись нельзя. Экземпляры `Ratelimit` кэшируются по паре
 * `limit/window` — на каждый запрос новый клиент Redis не создаётся.
 *
 * Про отсутствие Upstash. Раньше без переменных модуль молча пропускал всё.
 * Выглядело удобно, а на деле означало, что защита, ради которой писался весь
 * этот код, не работала в проде и никак этого не показывала. Теперь молчаливых
 * вариантов нет: в разработке — предупреждение в консоль, в production —
 * отказ. Осознанно жить без лимита можно, но это решение принимается явно,
 * переменной `RATE_LIMIT_DISABLED=1`, а не забытой настройкой.
 */

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;

/** Явный отказ от лимита. Осмысленно для однопользовательской установки. */
const disabledOnPurpose = process.env.RATE_LIMIT_DISABLED === '1';

export class RateLimitNotConfiguredError extends Error {
  readonly code = 'RATE_LIMIT_NOT_CONFIGURED';
}

/** Предупреждение печатается один раз за жизнь процесса, а не на каждый запрос. */
let warned = false;

function reportMissingConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new RateLimitNotConfiguredError(
      'UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN не заданы — лимит запросов не работает. ' +
        'Заведите базу Upstash Redis или задайте RATE_LIMIT_DISABLED=1, если лимит не нужен осознанно.',
    );
  }
  if (!warned) {
    warned = true;
    console.warn(
      'Лимит запросов выключен: нет UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN. ' +
        'В production такая конфигурация вернёт ошибку.',
    );
  }
}

/** Окно в формате `@upstash/ratelimit`: `'1 m'`, `'1 h'`, `'30 s'`. */
type Window = `${number} ${'s' | 'm' | 'h' | 'd'}`;

export type RateLimitOptions = { limit: number; window: Window };

const DEFAULT_OPTIONS: RateLimitOptions = { limit: 20, window: '1 m' };

const limiters = new Map<string, Ratelimit>();

function limiterFor(options: RateLimitOptions): Ratelimit | null {
  if (!redis) return null;

  const cacheKey = `${options.limit}:${options.window}`;
  const cached = limiters.get(cacheKey);
  if (cached) return cached;

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(options.limit, options.window),
    prefix: `neurolearn:ratelimit:${cacheKey}`,
  });
  limiters.set(cacheKey, limiter);
  return limiter;
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions = DEFAULT_OPTIONS,
): Promise<RateLimitResult> {
  if (disabledOnPurpose) return { allowed: true };

  const limiter = limiterFor(options);
  if (!limiter) {
    reportMissingConfig();
    return { allowed: true };
  }

  const result = await limiter.limit(key);
  if (result.success) return { allowed: true };

  return { allowed: false, retryAfterSeconds: Math.ceil((result.reset - Date.now()) / 1000) };
}
