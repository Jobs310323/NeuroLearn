import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Лимит запросов к дорогим AI-роутам. Без Upstash-аккаунта (личный проект,
 * учётки может не быть) — no-op: пропускает всё, чтобы приложение работало
 * и без внешнего сервиса. Настраивается пара переменных — как только они
 * заданы, лимит включается сам, без смены кода.
 */

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const limiter =
  url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(20, '1 m'),
        prefix: 'neurolearn:ratelimit',
      })
    : null;

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  if (!limiter) return { allowed: true };

  const result = await limiter.limit(key);
  if (result.success) return { allowed: true };

  return { allowed: false, retryAfterSeconds: Math.ceil((result.reset - Date.now()) / 1000) };
}
