import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  configuredProviders,
  defaultModelRef,
  fallbackChain,
  formatModelRef,
  parseModelRef,
  primaryProvider,
} from './model-adapter';

/**
 * Разбор ссылок `провайдер:модель` и сборка цепочки резерва.
 *
 * Работа с сетью не проверяется — для этого есть `npm run test:providers`,
 * который делает настоящие вызовы. Здесь только то, что решается локально и
 * ломается молча: чужой ключ в цепочке, потерянный суффикс `:free`,
 * провайдер без ключа, попавший в резерв.
 */

// Список должен покрывать ВСЕ ключи провайдеров: забытый ключ, реально
// заданный в окружении запуска, попал бы в `configuredProviders()` и менял бы
// ожидаемые цепочки резерва — тест краснел бы только на машине с этим ключом.
const PROVIDER_ENV = [
  'DEEPSEEK_API_KEY',
  'GROQ_API_KEY',
  'CEREBRAS_API_KEY',
  'TOGETHER_API_KEY',
  'MISTRAL_API_KEY',
  'OPENROUTER_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'AI_PROVIDER',
  'AI_MODEL_CONTENT_GENERATOR',
  'AI_MODEL_CONTENT_GENERATOR_FALLBACKS',
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of PROVIDER_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of PROVIDER_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('parseModelRef', () => {
  it('разбирает префикс провайдера', () => {
    expect(parseModelRef('groq:openai/gpt-oss-120b', 'mistral')).toEqual({
      provider: 'groq',
      modelId: 'openai/gpt-oss-120b',
    });
  });

  it('режет по первому двоеточию — суффикс :free остаётся в имени модели', () => {
    expect(parseModelRef('openrouter:nvidia/nemotron-3-super-120b-a12b:free', 'groq')).toEqual({
      provider: 'openrouter',
      modelId: 'nvidia/nemotron-3-super-120b-a12b:free',
    });
  });

  it('строка без известного префикса — модель текущего провайдера', () => {
    // Так продолжают работать старые значения AI_MODEL_*, где писали голый id.
    expect(parseModelRef('nvidia/nemotron-3-super-120b-a12b:free', 'openrouter')).toEqual({
      provider: 'openrouter',
      modelId: 'nvidia/nemotron-3-super-120b-a12b:free',
    });
  });

  it('неизвестный префикс не считается провайдером', () => {
    expect(parseModelRef('anthropic:claude', 'groq')).toEqual({
      provider: 'groq',
      modelId: 'anthropic:claude',
    });
  });

  it('formatModelRef обратен parseModelRef', () => {
    const raw = 'mistral:mistral-large-latest';
    expect(formatModelRef(parseModelRef(raw, 'groq'))).toBe(raw);
  });
});

describe('primaryProvider', () => {
  it('явный AI_PROVIDER главнее набора ключей', () => {
    process.env.AI_PROVIDER = 'mistral';
    process.env.GROQ_API_KEY = 'x'.repeat(30);
    expect(primaryProvider()).toBe('mistral');
  });

  it('без AI_PROVIDER берётся первый настроенный по приоритету', () => {
    process.env.MISTRAL_API_KEY = 'x'.repeat(30);
    process.env.GROQ_API_KEY = 'x'.repeat(30);
    // groq стоит в PROVIDER_ORDER раньше mistral.
    expect(primaryProvider()).toBe('groq');
  });

  it('пустая строка ключом не считается', () => {
    process.env.DEEPSEEK_API_KEY = '';
    process.env.GROQ_API_KEY = 'x'.repeat(30);
    expect(configuredProviders()).toEqual(['groq']);
  });
});

describe('defaultModelRef', () => {
  it('AI_MODEL_* переопределяет модель и может сменить провайдера', () => {
    process.env.AI_MODEL_CONTENT_GENERATOR = 'mistral:mistral-medium-latest';
    expect(defaultModelRef('content_generator', 'groq')).toEqual({
      provider: 'mistral',
      modelId: 'mistral-medium-latest',
    });
  });
});

describe('fallbackChain', () => {
  it('собирается сама из настроенных провайдеров, без основного', () => {
    process.env.GROQ_API_KEY = 'x'.repeat(30);
    process.env.MISTRAL_API_KEY = 'x'.repeat(30);
    process.env.OPENROUTER_API_KEY = 'x'.repeat(30);

    const chain = fallbackChain('content_generator', 'groq').map((r) => r.provider);
    expect(chain).toEqual(['mistral', 'openrouter']);
  });

  it('провайдер без ключа в резерв не попадает', () => {
    // Иначе переключение на резерв гарантированно падало бы на
    // AiNotConfiguredError вместо того, ради чего резерв заводили.
    process.env.GROQ_API_KEY = 'x'.repeat(30);
    expect(fallbackChain('content_generator', 'groq')).toEqual([]);
  });

  it('явный список главнее автоматического', () => {
    process.env.GROQ_API_KEY = 'x'.repeat(30);
    process.env.MISTRAL_API_KEY = 'x'.repeat(30);
    process.env.AI_MODEL_CONTENT_GENERATOR_FALLBACKS = 'mistral:mistral-small-latest';

    expect(fallbackChain('content_generator', 'groq')).toEqual([
      { provider: 'mistral', modelId: 'mistral-small-latest' },
    ]);
  });

  it('из явного списка ненастроенные провайдеры тоже отбрасываются', () => {
    process.env.GROQ_API_KEY = 'x'.repeat(30);
    process.env.AI_MODEL_CONTENT_GENERATOR_FALLBACKS = 'deepseek:deepseek-v4-pro,mistral:mistral-large-latest';

    expect(fallbackChain('content_generator', 'groq')).toEqual([]);
  });
});
