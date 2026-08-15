import { config } from 'dotenv';

config({ path: '.env.local' });

const { db } = await import('@/lib/db');
const { aiGenerations } = await import('@/lib/db/schema');
const { desc } = await import('drizzle-orm');

const rows = await db
  .select()
  .from(aiGenerations)
  .orderBy(desc(aiGenerations.createdAt))
  .limit(10);

for (const r of rows) {
  console.log(
    `${r.createdAt.toISOString()} ${r.agent}/${r.operation} ${r.status} retry=${r.retryCount} ${r.latencyMs ?? '-'}ms in=${r.tokensIn ?? '-'} out=${r.tokensOut ?? '-'}`,
  );
  if (r.validationError) console.log(`   error: ${r.validationError.slice(0, 400)}`);
}
