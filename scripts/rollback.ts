/**
 * Откат одной миграции: `npm run db:rollback 0004_push_devices`.
 *
 * Зачем отдельный скрипт, а не `drizzle-kit`: у drizzle-kit отката нет вовсе —
 * он умеет только накатывать. Правило проекта («каждая таблица — миграция и
 * откат») без исполнителя оставалось бы бумажным: файлы в `drizzle/down/`
 * писались бы, но никогда не проверялись бы на исполнимость.
 *
 * Скрипт снимает запись из журнала `drizzle.__drizzle_migrations` по хешу
 * ПРЯМОЙ миграции — тогда следующий `db:migrate` накатит её заново, и цикл
 * «накатить → откатить → накатить» замкнут.
 *
 * Откат — разрушающее действие: колонки и таблицы уходят вместе с данными.
 * Поэтому требуется подтверждение `--yes`.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sql } from './_sql';

const [tagArg, ...flags] = process.argv.slice(2);

if (!tagArg) {
  console.error('Укажите миграцию: npm run db:rollback 0004_push_devices [--yes]');
  process.exit(1);
}

const tag = tagArg.replace(/\.sql$/, '').replace(/\.down$/, '');
const upPath = join('./drizzle', `${tag}.sql`);
const downPath = join('./drizzle/down', `${tag}.down.sql`);

const down = await readFile(downPath, 'utf8').catch(() => null);
if (down === null) {
  console.error(`Нет файла отката: ${downPath}`);
  process.exit(1);
}

if (!flags.includes('--yes')) {
  console.error(
    `Откат ${tag} удалит объекты вместе с данными. Повторите с флагом --yes, если это осознанное решение.`,
  );
  process.exit(1);
}

const statements = down
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`- ${tag}: ${statements.length} операторов отката`);
for (const [i, statement] of statements.entries()) {
  try {
    await sql(statement);
  } catch (error) {
    console.error(`\nОшибка отката ${tag}, оператор #${i + 1}:\n${statement}\n`);
    throw error;
  }
}

// Журнал ведётся по хешу содержимого прямой миграции (см. scripts/migrate.ts).
const up = await readFile(upPath, 'utf8').catch(() => null);
if (up !== null) {
  const hash = createHash('sha256').update(up).digest('hex');
  await sql('DELETE FROM drizzle.__drizzle_migrations WHERE hash = $1', [hash]);
  console.log('Запись в журнале миграций снята — db:migrate накатит её заново.');
} else {
  console.warn(
    `Файл ${upPath} не найден: откат выполнен, но запись в журнале снять не по чему.`,
  );
}

console.log(`Готово. Откачено: ${tag}.`);
