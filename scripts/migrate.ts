/**
 * Применение миграций через HTTP-эндпоинт Neon.
 *
 * Почему не `drizzle-kit migrate`: он ходит по WebSocket, а порт 5432 и WSS
 * закрыты в части сетей. Штатный HTTP-мигратор Drizzle шлёт весь файл одним
 * запросом и обрывается на больших миграциях, поэтому здесь операторы
 * выполняются по одному, с повторами (см. `scripts/_sql.ts`).
 *
 * Журнал совместим с Drizzle: таблица `drizzle.__drizzle_migrations`,
 * `hash` = sha256 содержимого файла.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { sql } from './_sql';

const folder = './drizzle';

await sql('CREATE SCHEMA IF NOT EXISTS drizzle');
await sql(`
  CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`);

const applied = new Set<string>(
  ((await sql('SELECT hash FROM drizzle.__drizzle_migrations')) as { hash: string }[]).map(
    (r) => r.hash,
  ),
);

const files = (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort();

let appliedCount = 0;
for (const file of files) {
  const content = await readFile(join(folder, file), 'utf8');
  const hash = createHash('sha256').update(content).digest('hex');
  if (applied.has(hash)) {
    console.log(`= ${file} (уже применена)`);
    continue;
  }

  const statements = content
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`+ ${file}: ${statements.length} операторов`);
  let skipped = 0;
  for (const [i, statement] of statements.entries()) {
    try {
      await sql(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Обрыв соединения может потерять ответ уже выполненного оператора.
      // Повторный прогон видит объект существующим — это не ошибка миграции.
      if (/already exists/i.test(message)) {
        skipped += 1;
        continue;
      }
      console.error(`\nОшибка в ${file}, оператор #${i + 1}:\n${statement}\n`);
      throw error;
    }
    if ((i + 1) % 20 === 0) console.log(`  … ${i + 1}/${statements.length}`);
  }
  if (skipped > 0) console.log(`  пропущено как уже существующие: ${skipped}`);

  await sql('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [
    hash,
    Date.now(),
  ]);
  appliedCount += 1;
}

console.log(`Готово. Применено миграций: ${appliedCount}.`);
