import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { aiGenerations, knowledgeNodes, learningPaths } from '@/lib/db/schema';

import { ContentGenerationError } from './agents/content-generator';

/**
 * Состояние фоновой генерации модуля для опроса из интерфейса.
 *
 * Источник истины — `knowledge_nodes.content_ready` (материал реально в БД)
 * плюс последняя строка аудита по узлу (что происходит прямо сейчас или чем
 * закончилось). Два поля вместо одного: успешная запись и успешный вызов
 * модели — разные события, и после провала второго вызова узел остаётся
 * не готов при том, что первый прошёл.
 */
const MODULE_OPERATIONS = [
  'generate_module_blocks_a',
  'generate_module_blocks_b',
  'generate_module_assessments',
];

export type ModuleGenerationStatus = {
  nodeId: string;
  contentReady: boolean;
  /** null — генерация ни разу не запускалась. */
  status: 'pending' | 'succeeded' | 'schema_failed' | 'provider_failed' | null;
  operation: string | null;
  error: string | null;
  startedAt: string | null;
};

export async function moduleGenerationStatus(params: {
  userId: string;
  nodeId: string;
}): Promise<ModuleGenerationStatus> {
  const node = await db
    .select({ contentReady: knowledgeNodes.contentReady, ownerId: learningPaths.userId })
    .from(knowledgeNodes)
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(eq(knowledgeNodes.id, params.nodeId))
    .limit(1);

  const found = node[0];
  if (!found || found.ownerId !== params.userId) {
    throw new ContentGenerationError('Узел не найден', 'NOT_FOUND');
  }

  const [latest] = await db
    .select({
      status: aiGenerations.status,
      operation: aiGenerations.operation,
      validationError: aiGenerations.validationError,
      createdAt: aiGenerations.createdAt,
    })
    .from(aiGenerations)
    .where(
      and(
        eq(aiGenerations.targetId, params.nodeId),
        inArray(aiGenerations.operation, MODULE_OPERATIONS),
      ),
    )
    .orderBy(desc(aiGenerations.createdAt))
    .limit(1);

  return {
    nodeId: params.nodeId,
    contentReady: found.contentReady,
    status: latest?.status ?? null,
    operation: latest?.operation ?? null,
    // Полный текст ошибки — это сырой ответ модели на тысячи символов;
    // интерфейсу нужен только повод показать, что пошло не так.
    error: latest?.validationError?.slice(0, 3000) ?? null,
    startedAt: latest?.createdAt.toISOString() ?? null,
  };
}
