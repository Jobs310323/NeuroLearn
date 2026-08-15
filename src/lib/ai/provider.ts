import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

/**
 * Выбор провайдера и моделей.
 *
 * По умолчанию — бесплатные модели OpenRouter (суффикс `:free`). Переход на
 * платные — смена значения переменной окружения, код не меняется.
 *
 * Локальное ограничение: Cloudflare OpenRouter отсекает TLS-отпечаток Node,
 * поэтому с машины разработки запросы к нему получают 403 «Access denied by
 * security policy». На Vercel этого нет. Для локальной проверки задайте
 * `AI_PROVIDER=google` и ключ Google AI Studio.
 */

export type AgentKind =
  | 'content_generator'
  | 'tutor'
  | 'progress_analyzer'
  | 'metacognitive_coach';

type ProviderName = 'openrouter' | 'google';

/**
 * Модели по умолчанию. Все бесплатные и поддерживают инструменты и
 * структурированный вывод — без этого Zod-контракт генератора не выполнить.
 */
const DEFAULT_MODELS: Record<ProviderName, Record<AgentKind, string>> = {
  openrouter: {
    // Генератор контента: самый крупный из бесплатных, длинный контекст.
    content_generator: 'nvidia/nemotron-3-super-120b-a12b:free',
    // Тьютор: toolChoice='required' обязателен для гарантии сократического
    // формата — gpt-oss-20b (провайдер Darkbloom) его не поддерживает
    // (400 "inference-enforced tool_choice is not supported"), поэтому та же
    // модель, что и генератор контента.
    tutor: 'nvidia/nemotron-3-super-120b-a12b:free',
    progress_analyzer: 'openai/gpt-oss-20b:free',
    metacognitive_coach: 'google/gemma-4-26b-a4b-it:free',
  },
  google: {
    content_generator: 'gemini-2.5-flash',
    tutor: 'gemini-2.5-flash',
    progress_analyzer: 'gemini-2.5-flash',
    metacognitive_coach: 'gemini-2.5-flash',
  },
};

const ENV_OVERRIDE: Record<AgentKind, string> = {
  content_generator: 'AI_MODEL_CONTENT_GENERATOR',
  tutor: 'AI_MODEL_TUTOR',
  progress_analyzer: 'AI_MODEL_PROGRESS_ANALYZER',
  metacognitive_coach: 'AI_MODEL_METACOGNITIVE_COACH',
};

export class AiNotConfiguredError extends Error {
  readonly code = 'AI_NOT_CONFIGURED';
}

/** Экспортирован для `resilient-model.ts`: circuit breaker должен знать режим (google не резервируется). */
export function providerName(): ProviderName {
  const value = process.env.AI_PROVIDER?.trim().toLowerCase();
  return value === 'google' ? 'google' : 'openrouter';
}

export function modelIdFor(agent: AgentKind): string {
  const override = process.env[ENV_OVERRIDE[agent]]?.trim();
  return override || DEFAULT_MODELS[providerName()][agent];
}

/** Вынесено отдельно от `modelFor`, чтобы `resilient-model.ts` могло собрать модель по ЛЮБОМУ id из цепочки резерва, не только по дефолту агента. */
export function openRouterModel(modelId: string): LanguageModel {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new AiNotConfiguredError('OPENROUTER_API_KEY не задан.');
  }

  return createOpenRouter({
    apiKey,
    headers: {
      // OpenRouter показывает эти поля в статистике использования.
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
      'X-Title': 'NeuroLearn',
    },
  })(modelId);
}

export function modelFor(agent: AgentKind): LanguageModel {
  const name = providerName();
  const modelId = modelIdFor(agent);

  if (name === 'google') {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      throw new AiNotConfiguredError(
        'GOOGLE_GENERATIVE_AI_API_KEY не задан. Ключ бесплатно выдаётся в Google AI Studio.',
      );
    }
    return createGoogleGenerativeAI({ apiKey })(modelId);
  }

  return openRouterModel(modelId);
}

/**
 * Версия промпта на агента, не одна общая. Обновление системного промпта
 * тьютора не должно смешиваться с историей content_generator при разборе
 * регрессий по `ai_generations.prompt_version` (`scripts/_sql/prompt-regression.sql`).
 * Инкремент — при любой смысловой правке `src/lib/ai/prompts.ts` для этого агента.
 */
export const PROMPT_VERSIONS: Record<AgentKind, string> = {
  content_generator: '1.0.0',
  tutor: '1.0.0',
  progress_analyzer: '1.0.0',
  metacognitive_coach: '1.0.0',
};
