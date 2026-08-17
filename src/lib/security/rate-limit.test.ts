import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Поведение лимита запросов, когда Upstash не настроен.
 *
 * Проверяется именно это: раньше отсутствие переменных молча пропускало всё,
 * и выключенная защита выглядела как работающая. Модуль читает переменные на
 * загрузке, поэтому каждый случай требует свежего импорта (`resetModules`).
 */

// NODE_ENV здесь нет намеренно: в типах Node оно доступно только для чтения,
// присваивание не проходит `tsc`. Для него — `vi.stubEnv`.
const ENV_KEYS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RATE_LIMIT_DISABLED'];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('checkRateLimit без Upstash', () => {
  it('в разработке пропускает запрос, но предупреждает в консоль', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { checkRateLimit } = await import('./rate-limit');
    await expect(checkRateLimit('ключ')).resolves.toEqual({ allowed: true });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('предупреждение печатается один раз, а не на каждый запрос', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { checkRateLimit } = await import('./rate-limit');
    await checkRateLimit('ключ');
    await checkRateLimit('ключ');
    await checkRateLimit('другой');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('в production отказывает, а не пропускает молча', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const { RateLimitNotConfiguredError, checkRateLimit } = await import('./rate-limit');
    await expect(checkRateLimit('ключ')).rejects.toBeInstanceOf(RateLimitNotConfiguredError);
  });

  it('RATE_LIMIT_DISABLED=1 — осознанный отказ, молча пропускает даже в production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RATE_LIMIT_DISABLED = '1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { checkRateLimit } = await import('./rate-limit');
    await expect(checkRateLimit('ключ')).resolves.toEqual({ allowed: true });
    expect(warn).not.toHaveBeenCalled();
  });
});
