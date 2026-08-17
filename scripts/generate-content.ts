import { config } from 'dotenv';
config({ path: '.env.local' });

// Повтор пишущих запросов к Neon (`src/lib/db/index.ts`). Здесь он безопасен:
// идентификаторы строк генерируются до отправки, поэтому повтор потерянного
// ответа упирается в конфликт первичного ключа, а не создаёт дубль, а сам узел
// защищён от повторной генерации флагом `contentReady`. Задаётся здесь, а не
// в npm-скрипте: префикс `VAR=value` перед командой не работает в cmd/PowerShell.
process.env.NEURO_DB_RETRY_WRITES ??= '1';

// В CLI нет `instrumentation.ts`, где прокси включается для сервера Next.
// Без этого вызовы к провайдерам моделей идут мимо системного прокси и
// возвращают 403 — см. `src/lib/net/proxy.ts`.
const { enableEnvProxy } = await import('@/lib/net/proxy');
enableEnvProxy();

const { db } = await import('@/lib/db');
const { knowledgeNodes, learningPaths } = await import('@/lib/db/schema');
const { and, eq } = await import('drizzle-orm');
const { CLI_GENERATION_BUDGET_MS, assertModuleGeneratable, generateModuleForNode } = await import(
  '@/lib/ai/agents/content-generator'
);
const { reconcileStaleGenerations } = await import('@/lib/ai/reconcile');
const { isPermanentFailure, withJitteredBackoff } = await import('@/lib/ai/retry');

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

/** Причина остановки очереди; пока null — работа продолжается. */
let halted: string | null = null;

async function processNode(userId: string, node: NodeRow): Promise<Result> {
  if (halted) return { id: node.id, status: 'skipped', reason: 'очередь остановлена' };

  try {
    await assertModuleGeneratable({ userId, nodeId: node.id, regenerate: false });
  } catch (error) {
    return { id: node.id, status: 'skipped', reason: (error as Error).message };
  }

  try {
    await withJitteredBackoff(
      // Бюджет шире прод-потолка: у CLI нет `maxDuration`, а зашитые 260 секунд
      // на три последовательных вызова оставляют самому тяжёлому из них
      // (`generate_module_assessments`) считанные секунды.
      () =>
        generateModuleForNode({
          userId,
          nodeId: node.id,
          regenerate: false,
          budgetMs: CLI_GENERATION_BUDGET_MS,
        }),
      { retries: 1, baseMs: 5000 },
    );
    console.log(`✅ ${node.title}`);
    return { id: node.id, status: 'ok' };
  } catch (error) {
    console.error(`❌ ${node.title}: ${(error as Error).message}`);
    // Исчерпанная квота или пустой счёт не пройдут и на следующем узле:
    // очередь останавливается целиком. Прежде она добросовестно доходила до
    // конца списка, тратя на каждый узел по три попытки с backoff, и в итоге
    // отчёт состоял из пятнадцати одинаковых строк про один и тот же лимит.
    if (isPermanentFailure(error)) halted = (error as Error).message;
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

  if (halted) {
    console.log(
      `\nОчередь остановлена: ${halted}\n` +
        'Повторный запуск возьмёт только незавершённые узлы. Чтобы не упираться в один\n' +
        'апстрим, задайте ключ ещё одного провайдера — резервная цепочка соберётся сама\n' +
        '(см. README, «Ручные настройки»), проверка: npm run test:providers',
    );
  }

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
