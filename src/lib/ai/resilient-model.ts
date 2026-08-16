import { and, eq, gt } from 'drizzle-orm';
import type { LanguageModel } from 'ai';

import { db } from '@/lib/db';
import { aiGenerations } from '@/lib/db/schema';

import { FAILURE_THRESHOLD, FAILURE_WINDOW_MS, pickModel } from './breaker';
import { modelFor, modelIdFor, openRouterModel, providerName, type AgentKind } from './provider';

/**
 * Circuit breaker перед перегруженной бесплатной моделью OpenRouter.
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
 */

function fallbackChain(agent: AgentKind): string[] {
  const envKey = `AI_MODEL_${agent.toUpperCase()}_FALLBACKS`;
  return (process.env[envKey] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

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
  // Режим google — только для локальной разработки в обход блокировки TLS-
  // отпечатка Node у Cloudflare (см. комментарий в provider.ts). Резервных
  // моделей в этом режиме нет и не будет: это не прод-путь.
  if (providerName() === 'google') {
    return { model: modelFor(agent), modelId: modelIdFor(agent), tier: 'primary' };
  }

  const chain = [modelIdFor(agent), ...fallbackChain(agent)];

  const failuresByModel: Record<string, number> = {};
  for (const modelId of chain) {
    failuresByModel[modelId] = await recentFailureCount(modelId);
    // Дальше цепочки не считаем: решение уже принято в пользу этого звена.
    if (failuresByModel[modelId]! < FAILURE_THRESHOLD) break;
  }

  const { modelId, index } = pickModel(chain, failuresByModel);
  return { model: openRouterModel(modelId), modelId, tier: index === 0 ? 'primary' : 'fallback' };
}
