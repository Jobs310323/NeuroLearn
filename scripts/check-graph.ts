/** Прогоняет тот же запрос, что питает страницу карты знаний. */
import { config } from 'dotenv';

config({ path: '.env.local' });

const { db } = await import('@/lib/db');
const { learningPaths, users } = await import('@/lib/db/schema');
const { getPathGraph } = await import('@/lib/db/queries/paths');
const { eq } = await import('drizzle-orm');

const email = (process.env.AUTH_OWNER_EMAIL ?? '').trim().toLowerCase();
const owner = await db.query.users.findFirst({ where: eq(users.email, email) });
if (!owner) throw new Error('Владелец не найден.');

const path = await db.query.learningPaths.findFirst({
  where: eq(learningPaths.userId, owner.id),
});
if (!path) throw new Error('Путей нет.');

const graph = await getPathGraph(owner.id, path.id);
if (!graph) throw new Error('getPathGraph вернул null');

console.log(
  `OK узлов=${graph.nodes.length} рёбер=${graph.edges.length} ` +
    `заблокировано=${graph.nodes.filter((n) => n.locked).length} ` +
    `освоено=${graph.stats.mastered} автоматизм=${graph.stats.automated} ` +
    `пробелы=${graph.stats.hasGaps} повторить=${graph.stats.needsReview}`,
);
console.log(`URL: /paths/${path.id}`);
