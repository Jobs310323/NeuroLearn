import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Инвариант архитектуры, проверяемый не соглашением, а тестом.
 *
 * 1. Детерминированное ядро (`grader`, `fsrs`, `selector`, а теперь и движок
 *    подсказок) не импортирует `lib/ai`. Иначе при нулевом лимите провайдеров
 *    перестаёт работать не только генерация, но и проверка ответов, подбор
 *    и подсказки — то есть само обучение.
 *
 * 2. Подсказки не влияют на подбор заданий. `decidePolicy` не знает о них
 *    ничего, и движок подсказок ничего не знает о `decidePolicy`. Правило
 *    легко нарушить из лучших побуждений («устал — дадим меньше заданий»),
 *    и нарушение будет незаметным: подбор просто начнёт зависеть от
 *    невалидированного сигнала.
 *
 * Проверка идёт по исходникам, а не по графу импортов рантайма: `import type`
 * стирается при сборке, и рантайм-проверка пропустила бы связь, которая всё
 * равно означает зависимость от чужой модели данных.
 */

const SRC = resolve(import.meta.dirname, '../../..');

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(full)));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) files.push(full);
  }
  return files;
}

async function importsOf(file: string): Promise<string[]> {
  const source = await readFile(file, 'utf8');
  const specifiers: string[] = [];
  const pattern = /(?:from\s+|import\s*\()['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]!);
  return specifiers;
}

/** Каталоги, которые обязаны оставаться свободными от вызовов модели. */
const DETERMINISTIC_CORE = [
  'lib/practice/hints',
  'lib/services/practice',
  'lib/services/fsrs',
  'lib/services/graph',
  'lib/services/learner',
  'lib/notes',
  'features/knowledge-map/lib',
];

describe('детерминированное ядро не зависит от lib/ai', () => {
  it.each(DETERMINISTIC_CORE)('%s не импортирует lib/ai', async (relative) => {
    const files = await collectFiles(join(SRC, relative));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const specifiers = await importsOf(file);
      if (specifiers.some((s) => s.includes('lib/ai') || s.startsWith('ai') || s === 'ai')) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('подсказки не трогают подбор заданий', () => {
  it('движок подсказок не импортирует policy/selector', async () => {
    const files = await collectFiles(join(SRC, 'lib/practice/hints'));
    const offenders: string[] = [];

    for (const file of files) {
      const specifiers = await importsOf(file);
      if (specifiers.some((s) => /practice\/(policy|selector)/.test(s))) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('decidePolicy не знает о подсказках и об индексе усталости', async () => {
    const source = await readFile(join(SRC, 'lib/services/practice/policy.ts'), 'utf8');
    const specifiers = await importsOf(join(SRC, 'lib/services/practice/policy.ts'));

    expect(specifiers.some((s) => s.includes('hints'))).toBe(false);
    expect(specifiers.some((s) => s.includes('fatigue'))).toBe(false);
    // Прямое обращение к индексу усталости мимо импорта — тоже нарушение.
    expect(/responseTimeVariability/.test(source)).toBe(false);
  });

  it('selector не знает о подсказках', async () => {
    const specifiers = await importsOf(join(SRC, 'lib/services/practice/selector.ts'));
    expect(specifiers.some((s) => s.includes('hints'))).toBe(false);
  });
});
