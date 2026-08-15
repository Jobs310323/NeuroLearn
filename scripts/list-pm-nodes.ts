import { config } from 'dotenv';
config({ path: '.env.local' });

const { db } = await import('../src/lib/db');
const { knowledgeNodes, learningPaths } = await import('../src/lib/db/schema');
const { eq, ilike } = await import('drizzle-orm');

async function main() {
  const paths = await db
    .select({ id: learningPaths.id, title: learningPaths.title, userId: learningPaths.userId })
    .from(learningPaths)
    .where(ilike(learningPaths.title, '%продакт%'));

  for (const p of paths) {
    console.log(`PATH ${p.id} "${p.title}" user=${p.userId}`);
    const nodes = await db
      .select({
        id: knowledgeNodes.id,
        title: knowledgeNodes.title,
        contentReady: knowledgeNodes.contentReady,
        status: knowledgeNodes.status,
      })
      .from(knowledgeNodes)
      .where(eq(knowledgeNodes.pathId, p.id));
    for (const n of nodes) {
      console.log(`  ${n.contentReady ? 'READY' : 'PENDING'} ${n.status} ${n.id} ${n.title}`);
    }
    console.log(`  total=${nodes.length} ready=${nodes.filter((n) => n.contentReady).length}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
