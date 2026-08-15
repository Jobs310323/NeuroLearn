import { config } from 'dotenv';
config({ path: '.env.local' });

const { db } = await import('@/lib/db');
const { knowledgeNodes, learningPaths } = await import('@/lib/db/schema');
const { and, eq } = await import('drizzle-orm');
const { assertModuleGeneratable, generateModuleForNode } = await import(
  '@/lib/ai/agents/content-generator'
);
const { reconcileStaleGenerations } = await import('@/lib/ai/reconcile');
const { withJitteredBackoff } = await import('@/lib/ai/retry');

/**
 * CLI-замена ручного прогона очереди через браузерную вкладку: воспроизводимо,
 * переживает перезапуск терминала, повторный запуск трогает только узлы без
 * `contentReady`. Переиспользует `assertModuleGeneratable`/`generateModuleForNode` —
 * те же инварианты (10 блоков, ≥3 pre-assessment и т.д.), что и продовый
 * route handler, без дублирования правил валидации.
 */

const PATH_TITLE = process.argv[2] ?? 'Продакт-менеджмент';
// 1 = последовательно, щадит бесплатный тариф OpenRouter. Поднимать имеет
// смысл только вместе с платным резервом в AI_MODEL_CONTENT_GENERATOR_FALLBACKS.
const CONCURRENCY = Number(process.env.GENERATE_CONCURRENCY ?? 1);

type NodeRow = { id: string; title: string };
type Result =
  | { id: string; status: 'ok' }
  | { id: string; status: 'skipped'; reason: string }
  | { id: string; status: 'failed'; error: string };

async function findPendingNodes(): Promise<NodeRow[]> {
  const path = await db.query.learningPaths.findFirst({
    where: eq(learningPaths.title, PATH_TITLE),
  });
  if (!path) throw new Error(`Путь "${PATH_TITLE}" не найден.`);

  return db
    .select({ id: knowledgeNodes.id, title: knowledgeNodes.title })
    .from(knowledgeNodes)
    .where(and(eq(knowledgeNodes.pathId, path.id), eq(knowledgeNodes.contentReady, false)));
}

async function pathOwnerId(): Promise<string> {
  const path = await db.query.learningPaths.findFirst({
    where: eq(learningPaths.title, PATH_TITLE),
    columns: { userId: true },
  });
  if (!path) throw new Error(`Путь "${PATH_TITLE}" не найден.`);
  return path.userId;
}

async function processNode(userId: string, node: NodeRow): Promise<Result> {
  try {
    await assertModuleGeneratable({ userId, nodeId: node.id, regenerate: false });
  } catch (error) {
    return { id: node.id, status: 'skipped', reason: (error as Error).message };
  }

  try {
    await withJitteredBackoff(
      () => generateModuleForNode({ userId, nodeId: node.id, regenerate: false }),
      { retries: 1, baseMs: 5000 },
    );
    console.log(`✅ ${node.title}`);
    return { id: node.id, status: 'ok' };
  } catch (error) {
    console.error(`❌ ${node.title}: ${(error as Error).message}`);
    return { id: node.id, status: 'failed', error: (error as Error).message };
  }
}

/** Очередь с ограничением параллелизма — без внешних зависимостей. */
async function runQueue<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function next(): Promise<void> {
    const index = cursor++;
    if (index >= items.length) return;
    results[index] = await worker(items[index]!);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

async function main() {
  await reconcileStaleGenerations();

  const userId = await pathOwnerId();
  const nodes = await findPendingNodes();
  console.log(`${nodes.length} узлов без контента в пути "${PATH_TITLE}" (concurrency=${CONCURRENCY}).`);
  if (nodes.length === 0) return;

  const results = await runQueue(nodes, CONCURRENCY, (node) => processNode(userId, node));

  const ok = results.filter((r) => r.status === 'ok').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed');

  console.log(`\nИтог: ${ok}/${nodes.length} сгенерировано, ${skipped} пропущено.`);
  if (failed.length > 0) {
    console.log('Не удалось:');
    for (const f of failed) console.log(`  - ${f.id}: ${f.status === 'failed' ? f.error : ''}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
