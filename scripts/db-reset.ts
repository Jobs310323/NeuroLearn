/**
 * Полный сброс схемы `public` и журнала миграций.
 *
 * ОПАСНО: удаляет все таблицы и данные. Скрипт отказывается работать,
 * если в базе есть строки, — только явный флаг --force снимает защиту.
 *
 *   npx tsx scripts/db-reset.ts          # только пустую базу
 *   npx tsx scripts/db-reset.ts --force  # всегда
 */
import { sql } from './_sql';

const force = process.argv.includes('--force');

const [{ total }] = (await sql(
  "select coalesce(sum(n_live_tup),0)::int as total from pg_stat_user_tables where schemaname='public'",
)) as [{ total: number }];

if (total > 0 && !force) {
  console.error(`В базе ${total} строк. Сброс отменён. Повторите с --force, если это осознанно.`);
  process.exit(1);
}

await sql('DROP SCHEMA IF EXISTS public CASCADE');
await sql('CREATE SCHEMA IF NOT EXISTS public');
await sql('DROP SCHEMA IF EXISTS drizzle CASCADE');
console.log('Схема public пересоздана, журнал миграций очищен.');
