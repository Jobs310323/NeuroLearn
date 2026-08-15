import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { aiGenerations } from '@/lib/db/schema';

import { PROMPT_VERSIONS, type AgentKind } from './provider';

/**
 * Аудит вызовов LLM: стоимость, латентность, доля провалов Zod-валидации
 * по версиям промптов. Пишется всегда, даже при ошибке.
 */
export async function startGeneration(params: {
  userId: string | null;
  agent: AgentKind;
  operation: string;
  /** Модель, которую реально выбрал circuit breaker (`resolveModel`) — не обязательно дефолт агента. */
  modelId: string;
  targetTable?: string;
  targetId?: string;
}): Promise<string> {
  const [row] = await db
    .insert(aiGenerations)
    .values({
      userId: params.userId,
      agent: params.agent,
      operation: params.operation,
      model: params.modelId,
      promptVersion: PROMPT_VERSIONS[params.agent],
      status: 'pending',
      targetTable: params.targetTable ?? null,
      targetId: params.targetId ?? null,
    })
    .returning({ id: aiGenerations.id });

  if (!row) throw new Error('Не удалось создать запись аудита генерации.');
  return row.id;
}

export async function finishGeneration(
  generationId: string,
  result: {
    status: 'succeeded' | 'schema_failed' | 'provider_failed';
    validationError?: string;
    retryCount?: number;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    targetId?: string;
  },
): Promise<void> {
  await db
    .update(aiGenerations)
    .set({
      status: result.status,
      validationError: result.validationError?.slice(0, 4000) ?? null,
      retryCount: result.retryCount ?? 0,
      tokensIn: result.tokensIn ?? null,
      tokensOut: result.tokensOut ?? null,
      latencyMs: result.latencyMs ?? null,
      ...(result.targetId ? { targetId: result.targetId } : {}),
    })
    .where(eq(aiGenerations.id, generationId));
}
