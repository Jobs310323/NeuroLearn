/**
 * Тестовый путь «Продакт-менеджмент»: создаёт путь и прогоняет
 * ContentGenerator (generateTreeForPath) на реальном провайдере — сквозная
 * проверка Zod-контракта и записи в БД одним батчем.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

process.env.NEURO_DB_RETRY_WRITES = '1';

const { db } = await import('@/lib/db');
const { learningPaths, users } = await import('@/lib/db/schema');
const { generateTreeForPath } = await import('@/lib/ai/agents/content-generator');
const { eq, and } = await import('drizzle-orm');

const { resolveOwner } = await import('@/lib/auth/owner');
const { email } = resolveOwner();

const owner = await db.query.users.findFirst({ where: eq(users.email, email) });
if (!owner) throw new Error('Владелец не найден. Сначала запустите seed-demo.');

const TITLE = 'Продакт-менеджмент';

await db
  .delete(learningPaths)
  .where(and(eq(learningPaths.userId, owner.id), eq(learningPaths.title, TITLE)));

const pathId = crypto.randomUUID();
await db.insert(learningPaths).values({
  id: pathId,
  userId: owner.id,
  title: TITLE,
  goal: 'Научиться вести продукт от гипотезы до метрик: формулировать проблему пользователя, приоритизировать бэклог, писать проверяемые гипотезы, читать продуктовую аналитику и принимать решения на её основе, писать PRD и работать с командой разработки.',
  targetLevel: 'уверенный junior product manager',
  status: 'draft',
});

console.log(`Путь создан: ${pathId}`);
console.log('Запускаю генерацию дерева...');

const result = await generateTreeForPath({ userId: owner.id, pathId });

console.log(`Готово: ${result.nodeCount} узлов, ${result.edgeCount} связей.`);
