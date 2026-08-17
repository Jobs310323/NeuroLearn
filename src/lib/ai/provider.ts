import type { LanguageModel } from 'ai';

import {
  defaultModelRef,
  formatModelRef,
  languageModel,
  primaryProvider,
  type AgentKind,
} from './model-adapter';

/**
 * Выбор модели для агента.
 *
 * Реестр провайдеров и сборка клиентов живут в `model-adapter.ts` — здесь
 * только то, что нужно вызывающему коду: модель агента и версии промптов.
 * Прямые вызовы (`tutor.ts`, `defense-coach.ts`) идут через `modelFor` и
 * циркуляра резерва не знают: им нужен один вызов, а не цепочка. Всё, что
 * проходит через `generateValidated`, получает модель из `resolveModel`
 * (`resilient-model.ts`) — с circuit breaker и переключением на резерв.
 */

export { AiNotConfiguredError, type AgentKind } from './model-adapter';

/**
 * Идентификатор модели в виде `провайдер:модель`. Именно он пишется в
 * `ai_generations.model`, потому что одно и то же имя модели у разных
 * провайдеров — разные веса, разные лимиты и разная надёжность; складывать их
 * в один счётчик circuit breaker'а нельзя.
 */
export function modelIdFor(agent: AgentKind): string {
  return formatModelRef(defaultModelRef(agent, primaryProvider()));
}

export function modelFor(agent: AgentKind): LanguageModel {
  return languageModel(defaultModelRef(agent, primaryProvider()));
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
