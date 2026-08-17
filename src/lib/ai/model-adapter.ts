import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

/**
 * Реестр провайдеров моделей и сборка `LanguageModel` по ссылке вида
 * `провайдер:модель`.
 *
 * Зачем отдельный слой. Раньше провайдер был один (OpenRouter), и цепочка
 * резерва состояла из голых идентификаторов моделей — переключиться на другого
 * провайдера было нельзя в принципе. Это оказалось не теоретической проблемой:
 * Cloudflare перед OpenRouter отсекает TLS-отпечаток Node и отдаёт 403 «Access
 * denied by security policy» с машины разработки, а Google AI Studio недоступен
 * по региональным ограничениям. Работоспособных запасных путей не оставалось.
 *
 * Теперь звено цепочки несёт имя провайдера, поэтому резерв может уходить не
 * только на другую модель, но и в другую компанию: `deepseek:deepseek-v4-pro`
 * упал — берём `groq:openai/gpt-oss-120b`.
 *
 * Разделитель — первое двоеточие, а не последнее и не слэш: идентификаторы
 * моделей сами содержат и слэши (`openai/gpt-oss-120b`), и двоеточия
 * (суффикс `:free` у OpenRouter).
 */

export type AgentKind =
  | 'content_generator'
  | 'tutor'
  | 'progress_analyzer'
  | 'metacognitive_coach';

export type ProviderName =
  | 'deepseek'
  | 'groq'
  | 'together'
  | 'mistral'
  | 'openrouter'
  | 'google';

type ProviderSpec = {
  /** Для сообщений об ошибках и вывода скриптов. */
  label: string;
  apiKeyEnv: string;
  /** Где взять ключ — печатается, когда ключа нет. */
  signupUrl: string;
  /**
   * OpenAI-совместимый эндпоинт. `null` означает, что у провайдера собственный
   * адаптер в AI SDK и базовый адрес задавать не нужно.
   */
  baseUrl: string | null;
  /**
   * Просить `response_format: json_schema` вместо `json_object`.
   *
   * Не тонкая настройка, а условие работоспособности. В режиме `json_object`
   * Groq отвечает 400 «'messages' must contain the word 'json' in some form»,
   * а Mistral отдаёт JSON, не проходящий Zod. С `json_schema` оба выдают
   * корректный объект с первой попытки — схема уходит апстриму и соблюдается
   * там, а не выпрашивается словами в промпте.
   */
  structuredOutputs: boolean;
  models: Record<AgentKind, string>;
};

/**
 * Порядок ключей задаёт приоритет: первый настроенный провайдер становится
 * основным, если `AI_PROVIDER` не задан явно, и в этом же порядке строится
 * автоматическая цепочка резерва.
 *
 * Идентификаторы моделей сверены с `GET /v1/models` каждого провайдера
 * 2026-08-17, а не взяты из документации: у DeepSeek и Groq линейки уже
 * сменились, и половина «общеизвестных» имён (`deepseek-chat`,
 * `llama-3.3-70b-versatile`) больше не отвечает.
 */
const PROVIDERS: Record<ProviderName, ProviderSpec> = {
  deepseek: {
    label: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    signupUrl: 'https://platform.deepseek.com/api_keys',
    baseUrl: 'https://api.deepseek.com/v1',
    // Не проверено вживую: ключ, на котором шла проверка, отвечал
    // «Insufficient Balance» — до режима ответа дело не дошло. Если окажется,
    // что DeepSeek не понимает `json_schema`, это увидит `npm run test:providers`
    // первой же строкой.
    structuredOutputs: true,
    models: {
      // Генератор контента — единственное место, где качество структуры важнее
      // скорости: модуль из 10 блоков и банк заданий должны лечь в Zod-схему
      // с первой попытки, иначе повтор стоит ещё несколько минут.
      content_generator: 'deepseek-v4-pro',
      tutor: 'deepseek-v4-pro',
      progress_analyzer: 'deepseek-v4-flash',
      metacognitive_coach: 'deepseek-v4-flash',
    },
  },
  groq: {
    label: 'Groq',
    apiKeyEnv: 'GROQ_API_KEY',
    signupUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    // Проверено 2026-08-17: с `json_object` — 400, с `json_schema` — рабочий объект.
    structuredOutputs: true,
    models: {
      content_generator: 'openai/gpt-oss-120b',
      tutor: 'openai/gpt-oss-120b',
      progress_analyzer: 'openai/gpt-oss-20b',
      // qwen3.6-27b здесь стоял, но проваливает собственную же проверку схемы
      // на Groq («Failed to validate JSON»), а groq/compound вообще не
      // поддерживает `json_schema`. Из линейки Groq структурированный вывод
      // держит только gpt-oss.
      metacognitive_coach: 'openai/gpt-oss-20b',
    },
  },
  together: {
    label: 'Together AI',
    apiKeyEnv: 'TOGETHER_API_KEY',
    signupUrl: 'https://api.together.ai/settings/api-keys',
    baseUrl: 'https://api.together.xyz/v1',
    // Не проверено вживую: ключ, на котором шла проверка, отвергался как
    // недействительный (`Invalid API key provided`).
    structuredOutputs: true,
    models: {
      content_generator: 'deepseek-ai/DeepSeek-V3',
      tutor: 'deepseek-ai/DeepSeek-V3',
      progress_analyzer: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      metacognitive_coach: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    },
  },
  mistral: {
    label: 'Mistral',
    apiKeyEnv: 'MISTRAL_API_KEY',
    signupUrl: 'https://console.mistral.ai/api-keys',
    baseUrl: 'https://api.mistral.ai/v1',
    // Проверено 2026-08-17: с `json_object` ответ не проходил Zod, с `json_schema` проходит.
    structuredOutputs: true,
    models: {
      content_generator: 'mistral-large-latest',
      tutor: 'mistral-large-latest',
      progress_analyzer: 'mistral-small-latest',
      metacognitive_coach: 'mistral-small-latest',
    },
  },
  openrouter: {
    label: 'OpenRouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    signupUrl: 'https://openrouter.ai/keys',
    baseUrl: null,
    // Не используется: у OpenRouter собственный адаптер со своим режимом ответа.
    structuredOutputs: false,
    models: {
      content_generator: 'nvidia/nemotron-3-super-120b-a12b:free',
      // toolChoice='required' обязателен для сократического формата тьютора,
      // а gpt-oss-20b у провайдера Darkbloom его не поддерживает
      // (400 "inference-enforced tool_choice is not supported").
      tutor: 'nvidia/nemotron-3-super-120b-a12b:free',
      progress_analyzer: 'openai/gpt-oss-20b:free',
      metacognitive_coach: 'google/gemma-4-26b-a4b-it:free',
    },
  },
  google: {
    label: 'Google AI Studio',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    signupUrl: 'https://aistudio.google.com/apikey',
    baseUrl: null,
    // Не используется: у Google собственный адаптер.
    structuredOutputs: false,
    models: {
      content_generator: 'gemini-2.5-flash',
      tutor: 'gemini-2.5-flash',
      progress_analyzer: 'gemini-2.5-flash',
      metacognitive_coach: 'gemini-2.5-flash',
    },
  },
};

export const PROVIDER_ORDER = Object.keys(PROVIDERS) as ProviderName[];

const ENV_OVERRIDE: Record<AgentKind, string> = {
  content_generator: 'AI_MODEL_CONTENT_GENERATOR',
  tutor: 'AI_MODEL_TUTOR',
  progress_analyzer: 'AI_MODEL_PROGRESS_ANALYZER',
  metacognitive_coach: 'AI_MODEL_METACOGNITIVE_COACH',
};

export class AiNotConfiguredError extends Error {
  readonly code = 'AI_NOT_CONFIGURED';
}

export function providerSpec(provider: ProviderName): ProviderSpec {
  return PROVIDERS[provider];
}

export function isProviderName(value: string): value is ProviderName {
  return value in PROVIDERS;
}

function apiKeyFor(provider: ProviderName): string | undefined {
  const value = process.env[PROVIDERS[provider].apiKeyEnv]?.trim();
  return value ? value : undefined;
}

/** Настроен = задан непустой ключ. Ничего не проверяет по сети. */
export function isConfigured(provider: ProviderName): boolean {
  return apiKeyFor(provider) !== undefined;
}

export function configuredProviders(): ProviderName[] {
  return PROVIDER_ORDER.filter(isConfigured);
}

/**
 * Основной провайдер. Явный `AI_PROVIDER` главнее всего; иначе берётся первый
 * настроенный по приоритету `PROVIDER_ORDER`.
 *
 * Автовыбор нужен, чтобы одна и та же сборка работала и локально, и на Vercel
 * без правки переменных: ключи разных провайдеров заданы в разных средах.
 */
export function primaryProvider(): ProviderName {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit && isProviderName(explicit)) return explicit;

  const [first] = configuredProviders();
  // Ни одного ключа: возвращаем deepseek, чтобы сообщение об ошибке называло
  // конкретную переменную, а не «провайдер не выбран».
  return first ?? 'deepseek';
}

export type ModelRef = { provider: ProviderName; modelId: string };

/**
 * Разбирает `провайдер:модель`. Строка без известного префикса считается
 * идентификатором модели у `fallbackProvider` — так продолжают работать
 * переменные `AI_MODEL_*`, где раньше писали голый id OpenRouter.
 */
export function parseModelRef(raw: string, fallbackProvider: ProviderName): ModelRef {
  const separator = raw.indexOf(':');
  if (separator > 0) {
    const head = raw.slice(0, separator);
    if (isProviderName(head)) {
      return { provider: head, modelId: raw.slice(separator + 1) };
    }
  }
  return { provider: fallbackProvider, modelId: raw };
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}:${ref.modelId}`;
}

export function defaultModelRef(agent: AgentKind, provider: ProviderName): ModelRef {
  const override = process.env[ENV_OVERRIDE[agent]]?.trim();
  if (override) return parseModelRef(override, provider);
  return { provider, modelId: PROVIDERS[provider].models[agent] };
}

/**
 * Цепочка резерва для агента.
 *
 * Явная `AI_MODEL_<АГЕНТ>_FALLBACKS` (список ссылок через запятую) главнее.
 * Без неё цепочка собирается сама: все настроенные провайдеры в порядке
 * приоритета, кроме основного, каждый со своей моделью по умолчанию для этого
 * агента. Провайдеры без ключа отбрасываются на этом же шаге — иначе резерв
 * гарантированно падал бы на `AiNotConfiguredError` вместо переключения.
 */
export function fallbackChain(agent: AgentKind, provider: ProviderName): ModelRef[] {
  const envKey = `AI_MODEL_${agent.toUpperCase()}_FALLBACKS`;
  const explicit = (process.env[envKey] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => parseModelRef(raw, provider));

  const chain =
    explicit.length > 0
      ? explicit
      : configuredProviders()
          .filter((name) => name !== provider)
          .map((name) => ({ provider: name, modelId: PROVIDERS[name].models[agent] }));

  return chain.filter((ref) => isConfigured(ref.provider));
}

/**
 * Клиенты кэшируются по провайдеру: `createOpenAICompatible` заводит свой
 * fetch-стек, и создавать его на каждый вызов модели незачем. Ключ кэша
 * включает сам ключ доступа, чтобы подмена переменной окружения в тестах и
 * скриптах не отдавала клиента со старым ключом.
 */
type ModelFactory = (modelId: string) => LanguageModel;
const clients = new Map<string, ModelFactory>();

function clientFor(provider: ProviderName): ModelFactory {
  const spec = PROVIDERS[provider];
  const apiKey = apiKeyFor(provider);
  if (!apiKey) {
    throw new AiNotConfiguredError(
      `${spec.label}: переменная ${spec.apiKeyEnv} не задана. Ключ выдаётся здесь: ${spec.signupUrl}`,
    );
  }

  const cacheKey = `${provider}:${apiKey}`;
  const cached = clients.get(cacheKey);
  if (cached) return cached;

  let factory: ModelFactory;
  if (provider === 'google') {
    factory = createGoogleGenerativeAI({ apiKey });
  } else if (provider === 'openrouter') {
    factory = createOpenRouter({
      apiKey,
      headers: {
        // OpenRouter показывает эти поля в статистике использования.
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'NeuroLearn',
      },
    });
  } else {
    // DeepSeek, Groq, Together и Mistral отдают один и тот же интерфейс
    // `/chat/completions`, поэтому им хватает общего адаптера.
    factory = createOpenAICompatible({
      name: provider,
      baseURL: spec.baseUrl!,
      apiKey,
      supportsStructuredOutputs: spec.structuredOutputs,
    });
  }

  clients.set(cacheKey, factory);
  return factory;
}

export function languageModel(ref: ModelRef): LanguageModel {
  return clientFor(ref.provider)(ref.modelId);
}
