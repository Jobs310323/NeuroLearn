/**
 * Демонстрационные данные: владелец, путь и небольшое дерево знаний со связями.
 *
 * Нужен, чтобы проверить сквозной путь «схема → запросы → карта» без ручного
 * ввода и чтобы при первом входе было что открыть. Повторный запуск не
 * дублирует данные: путь ищется по названию.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

// Все записи ниже идемпотентны: id генерируются заранее, вставки идут
// с onConflictDoNothing. Значит повтор при обрыве сети безопасен.
process.env.NEURO_DB_RETRY_WRITES = '1';

const { db } = await import('@/lib/db');
const { knowledgeNodes, learningPaths, nodeEdges, nodeProgress, users } = await import(
  '@/lib/db/schema'
);
const { getPathGraph } = await import('@/lib/db/queries/paths');
const { eq, and } = await import('drizzle-orm');

const email = (process.env.AUTH_OWNER_EMAIL ?? '').trim().toLowerCase();
if (!email) throw new Error('AUTH_OWNER_EMAIL не задан.');

let owner = await db.query.users.findFirst({ where: eq(users.email, email) });
if (!owner) {
  const [created] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email,
      displayName: process.env.AUTH_OWNER_NAME ?? 'Owner',
      timezone: 'Europe/Moscow',
    })
    .returning();
  owner = created!;
  console.log('Создан профиль владельца.');
}

const TITLE = 'TypeScript в продакшене';

// Скрипт всегда пересоздаёт демонстрационный путь: при нестабильной сети
// предыдущий прогон мог оборваться на половине дерева.
await db
  .delete(learningPaths)
  .where(and(eq(learningPaths.userId, owner.id), eq(learningPaths.title, TITLE)));

// Идентификаторы генерируем на клиенте: при потере ответа повторная вставка
// той же строки отсекается по первичному ключу, а id уже известен.
const pathId = crypto.randomUUID();
{
  await db
    .insert(learningPaths)
    .values({
      id: pathId,
      userId: owner.id,
      title: TITLE,
      goal: 'Писать типобезопасный код без подсказок: строгие типы, сужение, дженерики, валидация границ.',
      targetLevel: 'Уверенно проектирую типы для чужого кода и вижу дыры в типизации',
      status: 'active',
    })
    .onConflictDoNothing();

  const tree: {
    key: string;
    parent: string | null;
    title: string;
    description: string;
    status: 'not_started' | 'in_progress' | 'mastered' | 'has_gaps' | 'automated' | 'needs_review';
    strength: number;
  }[] = [
    { key: 'root', parent: null, title: 'Система типов', description: 'Что такое тип и зачем компилятору структурная совместимость.', status: 'automated', strength: 94 },
    { key: 'narrowing', parent: 'root', title: 'Сужение типов', description: 'typeof, in, дискриминированные объединения, предикаты.', status: 'mastered', strength: 84 },
    { key: 'generics', parent: 'root', title: 'Дженерики', description: 'Параметризация, ограничения, вывод из аргументов.', status: 'in_progress', strength: 46 },
    { key: 'conditional', parent: 'generics', title: 'Условные типы', description: 'extends ? :, infer, распределение по объединениям.', status: 'has_gaps', strength: 22 },
    { key: 'mapped', parent: 'generics', title: 'Отображённые типы', description: 'keyof, as-переименование, модификаторы readonly и ?.', status: 'not_started', strength: 0 },
    { key: 'boundaries', parent: 'root', title: 'Границы приложения', description: 'Где типы перестают гарантировать и нужна проверка в рантайме.', status: 'needs_review', strength: 61 },
    { key: 'zod', parent: 'boundaries', title: 'Валидация схемой', description: 'Zod: вывод типа из схемы, разбор входных данных.', status: 'in_progress', strength: 38 },
    { key: 'errors', parent: 'boundaries', title: 'Типизация ошибок', description: 'Результат вместо исключения, сужение по коду ошибки.', status: 'not_started', strength: 0 },
  ];

  const idByKey = new Map<string, string>();

  for (const [index, item] of tree.entries()) {
    const depth = item.parent === null ? 0 : item.parent === 'root' ? 1 : 2;
    const nodeId = crypto.randomUUID();
    await db
      .insert(knowledgeNodes)
      .values({
        id: nodeId,
        pathId,
        parentId: item.parent ? idByKey.get(item.parent)! : null,
        slug: item.key,
        title: item.title,
        description: item.description,
        depth,
        orderIndex: index,
        status: item.status,
        weight: item.parent === null ? 1 : 0.6,
        difficulty: 0.3 + depth * 0.2,
        contentReady: false,
      })
      .onConflictDoNothing();

    idByKey.set(item.key, nodeId);

    await db
      .insert(nodeProgress)
      .values({
        nodeId,
        userId: owner.id,
        knowledgeStrength: item.strength,
        automaticityIndex: item.status === 'automated' ? 0.86 : item.strength / 200,
        accuracyRate: item.strength / 100,
        totalReps: Math.round(item.strength / 8),
      })
      .onConflictDoNothing();
  }

  const edges: [string, string, 'prerequisite' | 'related' | 'contrast' | 'analogous'][] = [
    ['root', 'narrowing', 'prerequisite'],
    ['narrowing', 'generics', 'prerequisite'],
    ['generics', 'conditional', 'prerequisite'],
    ['generics', 'mapped', 'prerequisite'],
    ['boundaries', 'zod', 'prerequisite'],
    ['conditional', 'mapped', 'related'],
    ['narrowing', 'errors', 'related'],
    ['zod', 'narrowing', 'analogous'],
  ];

  for (const [source, target, relation] of edges) {
    await db
      .insert(nodeEdges)
      .values({
        sourceId: idByKey.get(source)!,
        targetId: idByKey.get(target)!,
        relation,
        strength: relation === 'prerequisite' ? 1 : 0.6,
      })
      .onConflictDoNothing();
  }

  console.log(`Создан путь «${TITLE}» с ${tree.length} узлами и ${edges.length} связями.`);
}

// Тот же запрос, который питает страницу карты.
const graph = await getPathGraph(owner.id, pathId);
if (!graph) throw new Error('getPathGraph вернул null');

console.log(
  `Проверка запроса: узлов ${graph.nodes.length}, рёбер ${graph.edges.length}, ` +
    `заблокировано ${graph.nodes.filter((n) => n.locked).length}, ` +
    `освоено ${graph.stats.mastered}, автоматизм ${graph.stats.automated}`,
);
console.log(`URL карты: /paths/${pathId}`);
