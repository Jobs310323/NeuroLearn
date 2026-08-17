import { streamObject } from 'ai';
import { z } from 'zod';

import { languageModel, parseModelRef, primaryProvider, type ModelRef } from '@/lib/ai/model-adapter';
import { enableEnvProxy } from '@/lib/net/proxy';

// В CLI нет `instrumentation.ts`, поэтому прокси включается здесь — иначе
// зонд отчитается о недоступности провайдера, который на самом деле доступен.
enableEnvProxy();

/**
 * Общая часть `test-providers.ts` и `test-models.ts`: один структурированный
 * вызов модели с замером времени.
 *
 * Намеренно НЕ через `generateValidated` — тому нужен `DATABASE_URL` и он
 * пишет строку в `ai_generations`. Проверка доступности провайдера не должна
 * ни требовать базы, ни засорять аудит, ни тем более влиять на circuit breaker:
 * провал зонда — это про сеть и ключи, а не про качество модели в работе.
 */

/**
 * Схема специально с вложенностью и массивом фиксированной длины: плоский
 * `{ok: true}` выдаёт почти любая модель, а Zod-контракт генератора модулей
 * заметно сложнее. Проверять надо то, обо что реально спотыкаются.
 */
const probeSchema = z.object({
  language: z.string(),
  topic: z.string(),
  steps: z
    .array(z.object({ order: z.number().int(), action: z.string() }))
    .min(3)
    .max(3),
});

const PROBE_PROMPT =
  'Опиши ровно три шага заваривания чёрного чая. Поле language заполни строкой "ru", ' +
  'topic — коротким названием темы, steps — тремя шагами с порядковыми номерами 1, 2, 3.';

export type ProbeResult = {
  ref: string;
  ok: boolean;
  latencyMs: number;
  /** Причина провала, обрезанная до одной строки: полный стек здесь не нужен. */
  error?: string;
  sample?: string;
};

export async function probeModel(ref: ModelRef, timeoutMs = 90_000): Promise<ProbeResult> {
  const label = `${ref.provider}:${ref.modelId}`;
  const startedAt = Date.now();

  try {
    const stream = streamObject({
      model: languageModel(ref),
      schema: probeSchema,
      prompt: PROBE_PROMPT,
      maxOutputTokens: 700,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });

    // Чтение `fullStream` обязательно — по той же причине, что в
    // `generateValidated`: без него отказ апстрима не всплывает нигде и зонд
    // просто виснет вместо того, чтобы назвать причину.
    let streamError: unknown;
    for await (const part of stream.fullStream) {
      if (part.type === 'error') streamError = part.error;
    }
    if (streamError) throw streamError;

    const object = await stream.object;
    return {
      ref: label,
      ok: true,
      latencyMs: Date.now() - startedAt,
      sample: object.steps.map((s) => `${s.order}. ${s.action}`).join(' | ').slice(0, 160),
    };
  } catch (error) {
    return {
      ref: label,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: describe(error),
    };
  }
}

/**
 * Ошибка из `fullStream` приходит не всегда объектом `Error`: openai-совместимые
 * провайдеры кладут туда голый разобранный JSON ответа. `String(error)` на нём
 * даёт `[object Object]` — то есть ровно ту бесполезную строку, ради ухода от
 * которой зонд и писался. Поэтому разбираем вручную, до текста тела ответа.
 */
function describe(error: unknown): string {
  const seen = new Set<unknown>();

  const dig = (value: unknown, depth: number): string | undefined => {
    if (value == null || depth > 4 || seen.has(value)) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return String(value);
    seen.add(value);

    const record = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'responseBody', 'cause', 'reason']) {
      const nested = dig(record[key], depth + 1);
      if (nested) return nested;
    }
    return undefined;
  };

  return (dig(error, 0) ?? JSON.stringify(error) ?? String(error)).split('\n')[0]!.slice(0, 300);
}

export function refFromArg(raw: string): ModelRef {
  return parseModelRef(raw, primaryProvider());
}

export function formatRow(result: ProbeResult): string {
  const mark = result.ok ? 'OK  ' : 'СБОЙ';
  const seconds = (result.latencyMs / 1000).toFixed(1).padStart(6);
  const tail = result.ok ? (result.sample ?? '') : (result.error ?? '');
  return `${mark} ${seconds}s  ${result.ref.padEnd(42)} ${tail}`;
}
