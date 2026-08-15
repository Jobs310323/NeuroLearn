import { config } from 'dotenv';

config({ path: '.env.local' });

const { db } = await import('@/lib/db');
const { assessments, contentBlocks, knowledgeNodes } = await import('@/lib/db/schema');
const { asc, eq } = await import('drizzle-orm');

const title = process.argv[2] ?? 'Применять фреймворк RICE';

const node = await db.query.knowledgeNodes.findFirst({
  where: eq(knowledgeNodes.title, title),
});
if (!node) throw new Error(`Узел «${title}» не найден`);

console.log('node:', node.id, 'contentReady:', node.contentReady);

const blocks = await db
  .select()
  .from(contentBlocks)
  .where(eq(contentBlocks.nodeId, node.id))
  .orderBy(asc(contentBlocks.orderIndex));

console.log(`blocks: ${blocks.length}`);
for (const b of blocks) console.log(`  ${b.orderIndex + 1}. ${b.type} — ${b.title}`);

const items = await db.select().from(assessments).where(eq(assessments.nodeId, node.id));
console.log(`assessments: ${items.length}`);
console.log('  pre_assessment:', items.filter((a) => a.isPreAssessment).length);
console.log('  delayed feedback:', items.filter((a) => a.feedbackMode === 'delayed').length);
console.log('  variant groups:', new Set(items.map((a) => a.variantGroupId)).size);
for (const a of items.slice(0, 3)) {
  console.log(`  - [${a.cognitiveLevel}/${a.type}] ${a.prompt.slice(0, 90)}`);
}
