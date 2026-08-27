import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fuseRrf, toRanked } from './hybrid-search';
import { findContradictions, summarizeWeek } from './weekly';

/**
 * DoD Фазы W8: тетрадь работает при мёртвых провайдерах.
 *
 * Проверяется не «падает ли», а сохраняется ли ПОЛЬЗА. Приложение, которое
 * при отказе модели показывает пустой экран без ошибки, формально не упало —
 * и при этом бесполезно. Ниже зафиксировано, что именно остаётся живым.
 */

const SRC = resolve(import.meta.dirname, '../../..');

describe('деградация при отсутствии AI', () => {
  it('гибридный поиск без векторов вырождается в полнотекстовый, сохраняя порядок', () => {
    const fts = toRanked(['a', 'b', 'c']);
    expect(fuseRrf(fts, []).map((hit) => hit.id)).toEqual(['a', 'b', 'c']);
  });

  it('итог недели считается без модели целиком', () => {
    const stats = summarizeWeek([
      {
        id: 'a',
        type: 'idea',
        title: 'Мысль',
        contentMd: 'текст',
        nodeId: 'n1',
        createdAt: new Date(),
        linkCount: 1,
        confusionFlag: false,
      },
    ]);
    expect(stats.total).toBe(1);
    expect(stats.connectedShare).toBe(1);
  });

  it('противоречия отбираются правилами, а не моделью', () => {
    const found = findContradictions(
      [
        {
          id: 'a',
          type: 'summary',
          title: null,
          contentMd: 'Разобрался окончательно.',
          nodeId: 'n1',
          createdAt: new Date(),
          linkCount: 0,
          confusionFlag: false,
        },
      ],
      [
        {
          nodeId: 'n1',
          nodeTitle: 'Тема',
          status: 'has_gaps',
          accuracyRate: 0.3,
          totalReps: 20,
        },
      ],
    );
    expect(found).toHaveLength(1);
  });
});

/**
 * Структурная проверка: детерминированные пути тетради не должны получить
 * зависимость от `lib/ai` незаметно. Поиск, планировщик и недельная
 * статистика обязаны считаться без модели — этот тест не даст «временно»
 * подключить её туда.
 */
describe('детерминированные пути тетради не зависят от модели', () => {
  const DETERMINISTIC = [
    'lib/services/notes/hybrid-search.ts',
    'lib/services/notes/weekly.ts',
    'lib/services/notes/resurface.ts',
    'lib/services/notes/pipelines.ts',
    'lib/services/notes/conflict.ts',
    'lib/notes/search.ts',
    'lib/notes/export.ts',
    'lib/notes/markdown.ts',
  ];

  it.each(DETERMINISTIC)('%s не импортирует lib/ai', async (relative) => {
    const source = await readFile(join(SRC, relative), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*lib\/ai/);
  });

  it('маршруты тетради, отвечающие за чтение, не зависят от модели', async () => {
    // Список, а не обход всего каталога: `weekly` и `embeddings` к модели
    // обращаются законно, и тест должен это допускать явно.
    const readOnly = [
      'app/api/notes/route.ts',
      'app/api/notes/[noteId]/route.ts',
      'app/api/notes/export/route.ts',
      'app/api/notes/confusions/route.ts',
      'app/api/notes/search/route.ts',
    ];

    for (const relative of readOnly) {
      const source = await readFile(join(SRC, relative), 'utf8');
      expect(source, relative).not.toMatch(/from\s+['"][^'"]*lib\/ai/);
    }
  });

  it('каждый маршрут тетради проверяет владение пользователем явно', async () => {
    const dir = join(SRC, 'app/api/notes');
    const files = await collectRoutes(dir);
    expect(files.length).toBeGreaterThan(4);

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file.slice(SRC.length + 1)).toContain('requireUserIdOrThrow');
    }
  });
});

async function collectRoutes(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectRoutes(full)));
    else if (entry.name === 'route.ts') files.push(full);
  }
  return files;
}
