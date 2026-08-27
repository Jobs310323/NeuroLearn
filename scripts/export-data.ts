/**
 * Выгрузка всех личных данных обучения в JSONL.
 *
 * Зачем. История ответов и повторений — единственная часть проекта, которую
 * нельзя восстановить: код лежит в git, контент перегенерируется вызовом
 * модели, а `user_responses` и `review_logs` копятся годами и существуют в
 * одном экземпляре внутри Neon. Снимка не было вообще.
 *
 * Формат. По файлу на таблицу, одна строка — одна запись (JSONL): такой файл
 * читается построчно без загрузки целиком, дописывается и нормально ложится
 * в diff. Рядом `manifest.json` со счётчиками — по нему видно, что выгрузка
 * дошла до конца, а не оборвалась на середине.
 *
 * Второе назначение — вход для `fsrs-optimizer`: ему нужны именно
 * `review_logs` (карточка, оценка, момент повторения), и отдельного экспорта
 * под него теперь не требуется.
 *
 * Обратной загрузки здесь нет намеренно. Восстановление в живую базу — редкая
 * и опасная операция, её нельзя запускать той же командой, что и безобидную
 * выгрузку.
 *
 * Запуск:
 *   npm run export
 *   npm run export -- --out D:/backups/neurolearn
 *   npm run export -- --tables user_responses,review_logs
 */
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { sql } from './_sql';

/**
 * `key` — колонка для постраничного обхода. Читаем страницами, потому что
 * HTTP-эндпоинт Neon рвёт большие ответы: `user_responses` за пару лет
 * практики в один запрос не поместится.
 *
 * `key: null` — у таблицы составной первичный ключ (`node_edges`,
 * `node_sources`). Там страницы идут по OFFSET: обе таблицы маленькие, а
 * перескок строки при параллельной записи для ручной выгрузки неважен.
 */
type TableSpec = { name: string; key: string | null; order: string };

const TABLES: TableSpec[] = [
  { name: 'users', key: 'id', order: 'id' },
  { name: 'learning_paths', key: 'id', order: 'id' },
  { name: 'knowledge_nodes', key: 'id', order: 'id' },
  { name: 'node_edges', key: null, order: 'source_id, target_id, relation' },
  { name: 'node_progress', key: 'node_id', order: 'node_id' },
  { name: 'content_blocks', key: 'id', order: 'id' },
  { name: 'assessments', key: 'id', order: 'id' },
  { name: 'practice_sessions', key: 'id', order: 'id' },
  { name: 'user_responses', key: 'id', order: 'id' },
  { name: 'response_diagnoses', key: 'id', order: 'id' },
  { name: 'fsrs_cards', key: 'id', order: 'id' },
  { name: 'review_logs', key: 'id', order: 'id' },
  { name: 'reflections', key: 'id', order: 'id' },
  { name: 'projects', key: 'id', order: 'id' },
  { name: 'project_submissions', key: 'id', order: 'id' },
  { name: 'source_documents', key: 'id', order: 'id' },
  { name: 'source_chunks', key: 'id', order: 'id' },
  { name: 'node_sources', key: null, order: 'node_id, chunk_id' },
  { name: 'user_context', key: 'id', order: 'id' },
  { name: 'tutor_conversations', key: 'id', order: 'id' },
  { name: 'tutor_messages', key: 'id', order: 'id' },
  { name: 'ai_generations', key: 'id', order: 'id' },
];

const PAGE_SIZE = 500;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** `2026-08-26T10-31-05` — пригодно для имени каталога на любой ОС. */
function stamp(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
}

async function exportTable(spec: TableSpec, outDir: string): Promise<number> {
  const file = createWriteStream(join(outDir, `${spec.name}.jsonl`), { encoding: 'utf8' });
  let written = 0;
  let cursor: string | null = null;
  let offset = 0;

  try {
    for (;;) {
      // Тип указан явно: в тернарнике с двумя `await sql(...)` вывод типов
      // замыкается на саму переменную (TS7022).
      const rows: Record<string, unknown>[] = spec.key
        ? ((await sql(
            cursor === null
              ? `SELECT * FROM ${spec.name} ORDER BY ${spec.order} LIMIT ${PAGE_SIZE}`
              : `SELECT * FROM ${spec.name} WHERE ${spec.key} > $1 ORDER BY ${spec.order} LIMIT ${PAGE_SIZE}`,
            cursor === null ? [] : [cursor],
          )) as Record<string, unknown>[])
        : ((await sql(
            `SELECT * FROM ${spec.name} ORDER BY ${spec.order} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
          )) as Record<string, unknown>[]);

      if (rows.length === 0) break;

      for (const row of rows) {
        // Поток пишется без ожидания подтверждения на каждой строке; общий
        // разрыв ловится один раз в `finally` через `end`.
        file.write(`${JSON.stringify(row)}\n`);
      }
      written += rows.length;

      if (rows.length < PAGE_SIZE) break;
      if (spec.key) {
        cursor = String(rows[rows.length - 1]![spec.key]);
      } else {
        offset += rows.length;
      }
    }
  } finally {
    await new Promise<void>((done, fail) => file.end((error?: Error) => (error ? fail(error) : done())));
  }

  return written;
}

const requested = argValue('--tables')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const unknown = requested?.filter((name) => !TABLES.some((t) => t.name === name)) ?? [];
if (unknown.length > 0) {
  console.error(`Неизвестные таблицы: ${unknown.join(', ')}`);
  process.exit(1);
}

const tables = requested ? TABLES.filter((t) => requested.includes(t.name)) : TABLES;
const outDir = resolve(argValue('--out') ?? join('exports', stamp()));

await mkdir(outDir, { recursive: true });
console.log(`Выгрузка в ${outDir}`);

const counts: Record<string, number> = {};
const failures: Record<string, string> = {};

for (const spec of tables) {
  try {
    const written = await exportTable(spec, outDir);
    counts[spec.name] = written;
    console.log(`  ${spec.name}: ${written}`);
  } catch (error) {
    // Одна недоступная таблица не должна обнулять всю выгрузку: остальные
    // данные ценнее, а провал виден в манифесте и в коде возврата.
    const message = error instanceof Error ? error.message : String(error);
    failures[spec.name] = message;
    console.error(`  ${spec.name}: ОШИБКА — ${message}`);
  }
}

const migrations = (await sql(
  'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
).catch(() => [])) as { hash: string; created_at: number }[];

await writeFile(
  join(outDir, 'manifest.json'),
  `${JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      format: 'jsonl',
      // По списку применённых миграций видно, какой схеме соответствует
      // выгрузка: без этого через год не понять, чем читать старые файлы.
      migrations: migrations.map((m) => m.hash),
      counts,
      failures,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
if (Object.keys(failures).length > 0) {
  console.error(`\nВыгрузка неполная: ${total} записей, таблиц с ошибкой — ${Object.keys(failures).length}.`);
  process.exit(1);
}
console.log(`\nГотово: ${total} записей в ${tables.length} таблицах.`);
