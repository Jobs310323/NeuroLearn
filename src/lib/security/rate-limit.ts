import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Лимит запросов к дорогим AI-роутам. Без Upstash-аккаунта (личный проект,
 * учётки может не быть) — no-op: пропускает всё, чтобы приложение работало
 * и без внешнего сервиса. Настраивается пара переменных — как только они
 * заданы, лимит включается сам, без смены кода.
 *
 * Окно задаётся вызывающим: диалог с тьютором и генерация модуля стоят
 * несопоставимо разного (секунды против минут работы модели), поэтому одним
 * общим окном обойтись нельзя. Экземпляры `Ratelimit` кэшируются по паре
 * `limit/window` — на каждый запрос новый клиент Redis не создаётся.
 */

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;

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
  const limiter = limiterFor(options);
  if (!limiter) return { allowed: true };

  const result = await limiter.limit(key);
  if (result.success) return { allowed: true };

  return { allowed: false, retryAfterSeconds: Math.ceil((result.reset - Date.now()) / 1000) };
}
