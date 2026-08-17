import { describe, expect, it, vi } from 'vitest';

import { isPermanentFailure, withJitteredBackoff } from './retry';

/**
 * Отделение отказов, которые лечатся повтором, от тех, что не лечатся.
 *
 * Проверяется на настоящих текстах ошибок, снятых с апстримов, а не на
 * выдуманных: именно формулировка провайдера решает, сработает ли фильтр.
 */

describe('isPermanentFailure', () => {
  it.each([
    'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day',
    'Insufficient Balance',
    'Payment Required',
    'Invalid API key provided. You can find your API key at https://api.together.ai/settings/api-keys',
  ])('повтором не лечится: %s', (message) => {
    expect(isPermanentFailure(new Error(message))).toBe(true);
  });

  it.each([
    'The operation was aborted due to timeout',
    'Client network socket disconnected before secure TLS connection was established',
    'fetch failed',
    'No object generated: response did not match schema.',
  ])('повтор осмыслен: %s', (message) => {
    expect(isPermanentFailure(new Error(message))).toBe(false);
  });

  it('не падает на значении, которое не Error', () => {
    expect(isPermanentFailure({ error: 'Payment Required' })).toBe(false);
    expect(isPermanentFailure('Insufficient Balance')).toBe(true);
    expect(isPermanentFailure(null)).toBe(false);
  });
});

describe('withJitteredBackoff', () => {
  it('повторяет обычный отказ и возвращает результат удачной попытки', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce('готово');

    await expect(withJitteredBackoff(fn, { retries: 2, baseMs: 1 })).resolves.toBe('готово');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('на исчерпанной квоте не тратит оставшиеся попытки', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error('Rate limit exceeded: free-models-per-day'));

    await expect(withJitteredBackoff(fn, { retries: 3, baseMs: 1 })).rejects.toThrow('free-models-per-day');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('исчерпав повторы, отдаёт последнюю ошибку', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('timeout'));

    await expect(withJitteredBackoff(fn, { retries: 1, baseMs: 1 })).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
