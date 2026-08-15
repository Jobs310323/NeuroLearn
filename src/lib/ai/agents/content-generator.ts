import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  assessments,
  contentBlocks,
  knowledgeNodes,
  learningPaths,
  nodeEdges,
  nodeProgress,
  sourceChunks,
  sourceDocuments,
} from '@/lib/db/schema';
import {
  BLOCK_CITATION,
  feedbackModeFor,
  toAssessmentPayload,
  toContentPayload,
  toCorrectAnswer,
  variantGroupIds,
} from '@/lib/services/content/mapping';
import { slugify } from '@/lib/utils';

import { generateValidated } from '../generate';
import {
  CONTENT_GENERATOR_ASSESSMENTS_PROMPT,
  CONTENT_GENERATOR_TREE_PROMPT,
  buildBlocksPrompt,
} from '../prompts';
import { PROMPT_VERSIONS, modelIdFor } from '../provider';
import {
  BLOCK_GROUP_A,
  BLOCK_GROUP_B,
  CANONICAL_BLOCK_ORDER,
  moduleAssessmentsSchema,
  moduleBlockGroupSchema,
  treeGenerationSchema,
  type ModuleBlocks,
} from '../schemas';

/**
 * ContentGenerator: дерево знаний по цели и модуль из 10 блоков по узлу.
 *
 * Запись всегда одним `db.batch` — драйвер neon-http не даёт интерактивных
 * транзакций, но список запросов выполняется атомарно. Частично валидное
 * дерево в базу не попадает.
 */

/**
 * Сколько всего времени есть у одного запроса генерации. Чуть меньше
 * `maxDuration` route handler'ов: остаток нужен на запись в БД и на ответ.
 */
const GENERATION_BUDGET_MS = 260_000;

export class ContentGenerationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

// --- Дерево знаний ---------------------------------------------------------

export async function generateTreeForPath(params: {
  userId: string;
  pathId: string;
  replaceExisting?: boolean;
}): Promise<{ nodeCount: number; edgeCount: number }> {
  const path = await db.query.learningPaths.findFirst({
    where: and(eq(learningPaths.id, params.pathId), eq(learningPaths.userId, params.userId)),
  });
  if (!path) throw new ContentGenerationError('Путь не найден', 'NOT_FOUND');

  const existing = await db
    .select({ id: knowledgeNodes.id })
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.pathId, params.pathId));

  if (existing.length > 0 && !params.replaceExisting) {
    throw new ContentGenerationError(
      'У пути уже есть узлы. Повторная генерация удалит их.',
      'TREE_EXISTS',
    );
  }

  const sources = await collectSourceExcerpts(params.userId, params.pathId, path.goal);

  const prompt = [
    `Цель пользователя: ${path.goal}`,
    path.targetLevel ? `Целевой уровень: ${path.targetLevel}` : null,
    path.description ? `Дополнительно: ${path.description}` : null,
    sources
      ? `Опирайся на материалы пользователя, а не на общие знания:\n${sources}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  const { data } = await generateValidated({
    agent: 'content_generator',
    operation: 'generate_tree',
    userId: params.userId,
    system: CONTENT_GENERATOR_TREE_PROMPT,
    prompt,
    schema: treeGenerationSchema,
    targetTable: 'learning_paths',
    targetId: params.pathId,
    maxOutputTokens: 8000,
    retryBudgetMs: GENERATION_BUDGET_MS,
  });

  assertAcyclic(data.edges);

  // Идентификаторы и глубина считаются до записи: связи и родители ссылаются
  // друг на друга, а вставка идёт одним пакетом.
  const idByKey = new Map(data.nodes.map((node) => [node.key, crypto.randomUUID()]));
  const depthByKey = computeDepths(data.nodes);
  const usedSlugs = new Set<string>();

  const nodeRows = data.nodes.map((node, index) => {
    let slug = slugify(node.key || node.title);
    while (usedSlugs.has(slug)) slug = `${slug}-${index}`;
    usedSlugs.add(slug);

    return {
      id: idByKey.get(node.key)!,
      pathId: params.pathId,
      parentId: node.parentKey ? (idByKey.get(node.parentKey) ?? null) : null,
      slug,
      title: node.title,
      description: node.description,
      depth: depthByKey.get(node.key) ?? 0,
      orderIndex: index,
      weight: node.weight,
      difficulty: node.difficulty,
      estimatedMinutes: node.estimatedMinutes,
    };
  });

  const edgeRows = data.edges.map((edge) => ({
    sourceId: idByKey.get(edge.sourceKey)!,
    targetId: idByKey.get(edge.targetKey)!,
    relation: edge.relation,
    strength: edge.strength,
  }));

  const progressRows = nodeRows.map((node) => ({ nodeId: node.id, userId: params.userId }));

  const statements = [
    ...(existing.length > 0
      ? [db.delete(knowledgeNodes).where(eq(knowledgeNodes.pathId, params.pathId))]
      : []),
    db.insert(knowledgeNodes).values(nodeRows),
    db.insert(nodeProgress).values(progressRows),
    ...(edgeRows.length > 0
      ? [db.insert(nodeEdges).values(edgeRows).onConflictDoNothing()]
      : []),
    db
      .update(learningPaths)
      .set({
        status: 'active',
        generationMeta: {
          model: modelIdFor('content_generator'),
          promptVersion: PROMPT_VERSIONS.content_generator,
          generatedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(learningPaths.id, params.pathId)),
  ];

  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);

  return { nodeCount: nodeRows.length, edgeCount: edgeRows.length };
}

/** Глубина по цепочке родителей. Ограничена, чтобы цикл в parentKey не завесил обход. */
function computeDepths(nodes: { key: string; parentKey: string | null }[]): Map<string, number> {
  const parentByKey = new Map(nodes.map((n) => [n.key, n.parentKey]));
  const depths = new Map<string, number>();

  for (const node of nodes) {
    let depth = 0;
    let current = node.parentKey;
    while (current && depth < 12) {
      depth += 1;
      current = parentByKey.get(current) ?? null;
    }
    depths.set(node.key, depth);
  }

  return depths;
}

/** Проверка ацикличности prerequisite-связей до записи в БД. */
function assertAcyclic(edges: { sourceKey: string; targetKey: string; relation: string }[]): void {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.relation !== 'prerequisite') continue;
    const list = graph.get(edge.sourceKey);
    if (list) list.push(edge.targetKey);
    else graph.set(edge.sourceKey, [edge.targetKey]);
  }

  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (key: string): void => {
    const current = state.get(key);
    if (current === 'done') return;
    if (current === 'visiting') {
      throw new ContentGenerationError(
        `Модель вернула цикл зависимостей на узле ${key}`,
        'GRAPH_CYCLE',
      );
    }

    state.set(key, 'visiting');
    for (const next of graph.get(key) ?? []) visit(next);
    state.set(key, 'done');
  };

  for (const key of graph.keys()) visit(key);
}

// --- Модуль из 10 блоков ---------------------------------------------------

/**
 * Проверки, которые обязаны отработать ДО ответа клиенту: генерация идёт
 * в фоне, и после ответа сообщить «узел не найден» уже некому.
 */
export async function assertModuleGeneratable(params: {
  userId: string;
  nodeId: string;
  regenerate?: boolean;
}): Promise<void> {
  const row = await db
    .select({ contentReady: knowledgeNodes.contentReady, ownerId: learningPaths.userId })
    .from(knowledgeNodes)
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(eq(knowledgeNodes.id, params.nodeId))
    .limit(1);

  const found = row[0];
  if (!found || found.ownerId !== params.userId) {
    throw new ContentGenerationError('Узел не найден', 'NOT_FOUND');
  }
  if (found.contentReady && !params.regenerate) {
    throw new ContentGenerationError('Материал уже сгенерирован', 'CONTENT_EXISTS');
  }
}

export async function generateModuleForNode(params: {
  userId: string;
  nodeId: string;
  regenerate?: boolean;
}): Promise<{ blockCount: number; assessmentCount: number }> {
  const node = await db
    .select({
      id: knowledgeNodes.id,
      pathId: knowledgeNodes.pathId,
      title: knowledgeNodes.title,
      description: knowledgeNodes.description,
      difficulty: knowledgeNodes.difficulty,
      estimatedMinutes: knowledgeNodes.estimatedMinutes,
      contentReady: knowledgeNodes.contentReady,
      pathGoal: learningPaths.goal,
      ownerId: learningPaths.userId,
    })
    .from(knowledgeNodes)
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(eq(knowledgeNodes.id, params.nodeId))
    .limit(1);

  const found = node[0];
  if (!found || found.ownerId !== params.userId) {
    throw new ContentGenerationError('Узел не найден', 'NOT_FOUND');
  }
  if (found.contentReady && !params.regenerate) {
    throw new ContentGenerationError('Материал уже сгенерирован', 'CONTENT_EXISTS');
  }

  const neighbours = await db
    .select({ title: knowledgeNodes.title, relation: nodeEdges.relation })
    .from(nodeEdges)
    .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, nodeEdges.targetId))
    .where(eq(nodeEdges.sourceId, params.nodeId));

  const sources = await collectSourceExcerpts(
    params.userId,
    found.pathId,
    `${found.title} ${found.description ?? ''}`,
  );

  const prompt = [
    `Цель всего пути: ${found.pathGoal}`,
    `Узел: ${found.title}`,
    found.description ? `Описание узла: ${found.description}` : null,
    `Априорная сложность: ${found.difficulty}`,
    neighbours.length > 0
      ? `Смежные узлы для перемешанной практики: ${neighbours
          .map((n) => `${n.title} (${n.relation})`)
          .join(', ')}`
      : 'Смежных узлов нет — блок interleaved_practice построй на контрасте внутри самой темы.',
    sources ? `Материалы пользователя:\n${sources}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  // Три вызова вместо одного: блоки идут двумя половинами по 5, задания —
  // отдельно. Один вызов на все 10 блоков регулярно не укладывался в
  // терпение апстрима бесплатной модели (~120с на первый байт ответа);
  // вдвое меньше блоков на вызов — вдвое меньше токенов и времени.
  const startedAt = Date.now();

  const { data: blocksA } = await generateValidated({
    agent: 'content_generator',
    operation: 'generate_module_blocks_a',
    userId: params.userId,
    system: buildBlocksPrompt(BLOCK_GROUP_A),
    prompt,
    schema: moduleBlockGroupSchema(BLOCK_GROUP_A),
    targetTable: 'knowledge_nodes',
    targetId: params.nodeId,
    maxOutputTokens: 7000,
    retryBudgetMs: GENERATION_BUDGET_MS - (Date.now() - startedAt),
  });

  const { data: blocksB } = await generateValidated({
    agent: 'content_generator',
    operation: 'generate_module_blocks_b',
    userId: params.userId,
    system: buildBlocksPrompt(BLOCK_GROUP_B),
    prompt,
    schema: moduleBlockGroupSchema(BLOCK_GROUP_B),
    targetTable: 'knowledge_nodes',
    targetId: params.nodeId,
    maxOutputTokens: 7000,
    retryBudgetMs: GENERATION_BUDGET_MS - (Date.now() - startedAt),
  });

  // Канонический порядок восстанавливается здесь: тест до теории —
  // не оформление, а условие работы эффекта тестирования, и зависеть
  // от того, в каком порядке модель перечислила блоки, он не должен.
  const orderedBlocks = [...blocksA.blocks, ...blocksB.blocks].sort(
    (a, b) => CANONICAL_BLOCK_ORDER.indexOf(a.type) - CANONICAL_BLOCK_ORDER.indexOf(b.type),
  );

  const { data: assessmentsData } = await generateValidated({
    agent: 'content_generator',
    operation: 'generate_module_assessments',
    userId: params.userId,
    system: CONTENT_GENERATOR_ASSESSMENTS_PROMPT,
    prompt: `${prompt}\n\nСодержание уже готового модуля:\n${summarizeBlocks(orderedBlocks)}`,
    schema: moduleAssessmentsSchema,
    targetTable: 'knowledge_nodes',
    targetId: params.nodeId,
    // 8000 не хватало: 8-12 заданий с explanation и тремя socraticHints
    // каждое — свободная модель обрывала JSON на середине объекта,
    // finishReason при этом врал «stop» вместо «length».
    maxOutputTokens: 14000,
    retryBudgetMs: GENERATION_BUDGET_MS - (Date.now() - startedAt),
  });

  const blockIdByType = new Map(orderedBlocks.map((block) => [block.type, crypto.randomUUID()]));

  const blockRows = orderedBlocks.map((block, index) => ({
    id: blockIdByType.get(block.type)!,
    nodeId: params.nodeId,
    type: block.type,
    title: block.title,
    orderIndex: index,
    payload: toContentPayload(block),
    preAssessment: block.type === 'pre_assessment',
    scienceCitationKey: BLOCK_CITATION[block.type],
    generatedBy: modelIdFor('content_generator'),
  }));

  const groupIds = variantGroupIds(assessmentsData.assessments);

  const assessmentRows = assessmentsData.assessments.map((assessment) => {
    const mode = feedbackModeFor(assessment.cognitiveLevel);
    return {
      id: crypto.randomUUID(),
      nodeId: params.nodeId,
      contentBlockId:
        blockIdByType.get(assessment.isPreAssessment ? 'pre_assessment' : 'independent_practice') ??
        null,
      type: assessment.type,
      cognitiveLevel: assessment.cognitiveLevel,
      prompt: assessment.prompt,
      payload: toAssessmentPayload(assessment),
      correctAnswer: toCorrectAnswer(assessment),
      explanation: assessment.explanation,
      socraticHints: assessment.socraticHints,
      feedbackMode: mode,
      instantFeedback: mode === 'instant',
      delayedFeedback: mode === 'delayed',
      isPreAssessment: assessment.isPreAssessment,
      difficulty: found.difficulty,
      targetResponseMs: assessment.targetResponseSeconds * 1000,
      variantGroupId: groupIds.get(assessment.variantGroup)!,
      contextLabel: assessment.contextLabel,
    };
  });

  const statements = [
    ...(found.contentReady
      ? [
          db.delete(assessments).where(eq(assessments.nodeId, params.nodeId)),
          db.delete(contentBlocks).where(eq(contentBlocks.nodeId, params.nodeId)),
        ]
      : []),
    db.insert(contentBlocks).values(blockRows),
    db.insert(assessments).values(assessmentRows),
    db
      .update(knowledgeNodes)
      .set({ contentReady: true, updatedAt: new Date() })
      .where(eq(knowledgeNodes.id, params.nodeId)),
  ];

  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);

  return { blockCount: blockRows.length, assessmentCount: assessmentRows.length };
}

/**
 * Сжатая выжимка блоков для второго вызова: задания должны опираться на
 * то, что модуль реально объясняет, но целиком блоки в промпт не влезают.
 */
function summarizeBlocks(blocks: ModuleBlocks['blocks']): string {
  return blocks
    .map((block) => {
      const points = block.keyPoints.length > 0 ? ` Тезисы: ${block.keyPoints.join('; ')}` : '';
      return `- ${block.type} «${block.title}»: ${block.body.slice(0, 400)}${points}`;
    })
    .join('\n');
}

/**
 * Выдержки из импортированных материалов пользователя.
 * Пока берём начало документов; полнотекстовый подбор по теме появится
 * вместе с интерфейсом импорта.
 */
/**
 * Полнотекстовый поиск по своим источникам — без embeddings и платных API
 * (стандартное ограничение проекта). `to_tsvector` считается на лету: объём
 * личной библиотеки не требует персистентного индекса.
 *
 * Раньше отдавались первые 8 фрагментов ЛЮБОГО источника пользователя без
 * учёта пути и релевантности — `pathId` даже не использовался. Теперь ищем
 * по документам, привязанным к этому пути, ранжируя по совпадению с целью
 * пути или темой узла.
 */
async function collectSourceExcerpts(
  userId: string,
  pathId: string,
  queryText?: string,
): Promise<string | null> {
  const query = queryText?.trim();

  const rank = query
    ? sql<number>`ts_rank(to_tsvector('russian', ${sourceChunks.content}), plainto_tsquery('russian', ${query}))`
    : sql<number>`0`;

  const rows = await db
    .select({ content: sourceChunks.content, rank })
    .from(sourceChunks)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, sourceChunks.documentId))
    .where(
      and(
        eq(sourceChunks.userId, userId),
        eq(sourceDocuments.pathId, pathId),
        eq(sourceDocuments.status, 'ready'),
      ),
    )
    .orderBy(query ? desc(rank) : asc(sourceChunks.orderIndex))
    .limit(8);

  // Полнотекстовый поиск ничего не нашёл, но источники к пути привязаны —
  // отдаём хоть что-то по порядку, а не оставляем генератор без материала.
  const chunks =
    query && rows.every((r) => r.rank === 0)
      ? await db
          .select({ content: sourceChunks.content })
          .from(sourceChunks)
          .innerJoin(sourceDocuments, eq(sourceDocuments.id, sourceChunks.documentId))
          .where(
            and(
              eq(sourceChunks.userId, userId),
              eq(sourceDocuments.pathId, pathId),
              eq(sourceDocuments.status, 'ready'),
            ),
          )
          .orderBy(asc(sourceChunks.orderIndex))
          .limit(8)
      : rows;

  if (chunks.length === 0) return null;

  return chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.content.slice(0, 1200)}`)
    .join('\n\n');
}
