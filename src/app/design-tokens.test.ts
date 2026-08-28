import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Инвариант «цвет = данные», проверяемый механически.
 *
 * Правило легко нарушить из лучших побуждений: свечение «чтобы красивее»,
 * зелёная кнопка «потому что успех», градиент на карточке «для акцента».
 * Каждое такое место по отдельности выглядит безобидно, а вместе они убивают
 * ровно то, ради чего палитра статусов и заведена: карта знаний должна
 * читаться цветом с одного взгляда.
 *
 * Проверяется не «красиво ли», а два измеримых факта: захардкоженных
 * цветовых литералов в компонентах нет (всё через токены), и градиент
 * `aurora` встречается только там, где он что-то означает.
 */

const SRC = resolve(import.meta.dirname, '..');

async function collect(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full)));
    else if (/\.tsx$/.test(entry.name)) files.push(full);
  }
  return files;
}

/**
 * Места, где сырой цвет обоснован и потому разрешён явным списком.
 * Список короткий намеренно: он и есть та граница, за которой начинается
 * расползание палитры.
 */
const ALLOWED_RAW_COLOR = new Set([
  // Звёзды рисуются белым: это не элемент интерфейса и не несёт статуса.
  'components/starfield.tsx',
  // Скелетон карты — токены shimmer заданы шестнадцатеричными в @theme.
  'features/knowledge-map/components/knowledge-map.tsx',
  // `themeColor` в `meta` читается браузером до применения CSS, и переменную
  // там использовать нельзя. Совпадение с `--color-void` проверяется ниже
  // отдельным тестом — иначе при старте PWA видна полоса другого оттенка.
  'app/layout.tsx',
]);

describe('токены оформления', () => {
  it('компоненты не содержат сырых hex-цветов помимо разрешённых мест', async () => {
    const files = await collect(SRC);
    const offenders: string[] = [];

    for (const file of files) {
      const relative = file.slice(SRC.length + 1).replace(/\\/g, '/');
      if (ALLOWED_RAW_COLOR.has(relative)) continue;

      const source = await readFile(file, 'utf8');
      // Ищем именно цветовые литералы, а не любые решётки: `#0b0e1a`, `#fff`.
      const matches = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      // Якоря вида `#main` и id в JSX решёткой не начинаются с цифры/буквы
      // hex-набора целиком, но подстраховываемся длиной.
      const colors = matches.filter((m) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(m));
      if (colors.length > 0) offenders.push(`${relative}: ${colors.join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  it('цвет темы PWA совпадает с фоном приложения', async () => {
    const css = await readFile(join(SRC, 'app/globals.css'), 'utf8');
    const layout = await readFile(join(SRC, 'app/layout.tsx'), 'utf8');
    const manifest = await readFile(
      resolve(SRC, '..', 'public/manifest.json'),
      'utf8',
    );

    const void_ = /--color-void:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
    expect(void_).toBeTruthy();
    expect(layout).toContain(void_!);
    expect(JSON.parse(manifest).theme_color).toBe(void_);
    expect(JSON.parse(manifest).background_color).toBe(void_);
  });

  it('градиент aurora используется только как primary-действие или веха', async () => {
    const files = await collect(SRC);
    const users: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/\baurora\b/.test(source)) users.push(file.slice(SRC.length + 1).replace(/\\/g, '/'));
    }

    // Кнопка (primary-действие) и достижение уровня мастерства. Появление
    // третьего места — повод объяснить, что именно оно означает, а не
    // молча расширить список.
    expect(users.sort()).toEqual(['components/ui/button.tsx']);
  });

  it('в глобальных стилях объявлены все токены движения', async () => {
    const css = await readFile(join(SRC, 'app/globals.css'), 'utf8');
    for (const token of [
      '--ease-quart-out',
      '--duration-fast',
      '--duration-base',
      '--duration-slow',
      '--stagger-step',
    ]) {
      expect(css, token).toContain(token);
    }
  });

  it('бесконечные анимации гасятся при prefers-reduced-motion', async () => {
    const css = await readFile(join(SRC, 'app/globals.css'), 'utf8');
    const blocks = css.split('@media (prefers-reduced-motion: reduce)').slice(1).join('\n');

    // Мерцающий скелетон и «жидкая» полоса — единственные бесконечные
    // анимации в проекте; замедлить их недостаточно, нужно выключить.
    expect(blocks).toContain('.skeleton');
    expect(blocks).toContain('.progress-liquid');
  });

  it('светлая тема продукта отсутствует: единственное светлое место — бумажный режим', async () => {
    const css = await readFile(join(SRC, 'app/globals.css'), 'utf8');
    expect(css).not.toContain('prefers-color-scheme: light');
    expect(css).toContain('.note-paper');
  });
});
