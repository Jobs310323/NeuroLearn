import { and, eq, gt } from 'drizzle-orm';
import type { LanguageModel } from 'ai';

import { db } from '@/lib/db';
import { aiGenerations } from '@/lib/db/schema';

import { FAILURE_THRESHOLD, FAILURE_WINDOW_MS, pickModel } from './breaker';
import {
  defaultModelRef,
  fallbackChain,
  formatModelRef,
  languageModel,
  parseModelRef,
  primaryProvider,
  type AgentKind,
} from './model-adapter';

/**
 * Circuit breaker перед моделью, которая перестала отвечать.
 *
 * Состояние не хранится отдельно (никакого Redis/новой таблицы) — считается
 * из уже существующего аудита `ai_generations`, тем же принципом, что и
 * `reconcileStaleGenerations`: провалы провайдера за последнее окно решают,
 * доверять ли модели ещё одну попытку.
 *
 * `schema_failed` в счёт НЕ идёт: это дефект контракта конкретной модели
 * (не держит структурированный вывод), а не перегрузка апстрима — если
 * считать его тоже, breaker будет переключать модели там, где переключение
 * не поможет (резервная модель с тем же изъяном получит тот же провал).
 *
 * Звенья цепочки — ссылки `провайдер:модель`, поэтому переключение уходит
 * не только на соседнюю модель, но и к другому провайдеру. Это единственный
 * рабочий вид резерва: когда OpenRouter отдаёт 403 с машины разработки,
 * никакая другая его модель не поможет — нужен другой апстрим целиком.
 */

async function recentFailureCount(modelId: string): Promise<number> {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS);
  const rows = await db
    .select({ id: aiGenerations.id })
    .from(aiGenerations)
    .where(
      and(
        eq(aiGenerations.model, modelId),
        eq(aiGenerations.status, 'provider_failed'),
        gt(aiGenerations.createdAt, since),
      ),
    )
    .limit(FAILURE_THRESHOLD);
  return rows.length;
}

export type ResolvedModel = {
  model: LanguageModel;
  modelId: string;
  tier: 'primary' | 'fallback';
};

export async function resolveModel(agent: AgentKind): Promise<ResolvedModel> {
  const provider = primaryProvider();
  const chain = [
    formatModelRef(defaultModelRef(agent, provider)),
    ...fallbackChain(agent, provider).map(formatModelRef),
  ];

  const failuresByModel: Record<string, number> = {};
  for (const modelId of chain) {
    failuresByModel[modelId] = await recentFailureCount(modelId);
    // Дальше цепочки не считаем: решение уже принято в пользу этого звена.
    if (failuresByModel[modelId]! < FAILURE_THRESHOLD) break;
  }

  const { modelId, index } = pickModel(chain, failuresByModel);
  return {
    model: languageModel(parseModelRef(modelId, provider)),
    modelId,
    tier: index === 0 ? 'primary' : 'fallback',
  };
}
