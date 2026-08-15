import { config } from 'dotenv';

config({ path: '.env.local' });

const { db } = await import('@/lib/db');
const { knowledgeNodes, learningPaths } = await import('@/lib/db/schema');
const { eq } = await import('drizzle-orm');

const path = await db.query.learningPaths.findFirst({
  where: eq(learningPaths.title, 'Продакт-менеджмент'),
});
if (!path) throw new Error('Путь не найден');

await db.delete(knowledgeNodes).where(eq(knowledgeNodes.pathId, path.id));
console.log('Узлы удалены, путь пуст:', path.id);
