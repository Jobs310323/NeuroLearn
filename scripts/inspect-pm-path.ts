import { config } from 'dotenv';

config({ path: '.env.local' });

const { db } = await import('@/lib/db');
const { knowledgeNodes, learningPaths, nodeEdges } = await import('@/lib/db/schema');
const { eq } = await import('drizzle-orm');

const path = await db.query.learningPaths.findFirst({
  where: eq(learningPaths.title, 'Продакт-менеджмент'),
});
if (!path) throw new Error('Путь не найден');

console.log('path:', path.id, path.status, path.generationMeta);

const nodes = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.pathId, path.id));
console.log('nodes:', nodes.length);
for (const n of nodes) console.log(`- [${n.depth}] ${n.title} :: ${n.description?.slice(0, 80)}`);

if (nodes[0]) {
  const edges = await db.select().from(nodeEdges).where(eq(nodeEdges.sourceId, nodes[0].id));
  console.log('sample edges from first node:', edges.length);
}
