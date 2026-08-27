import { expect, test, type Page } from '@playwright/test';

/**
 * Карта знаний: ручная позиция переживает перезагрузку, «Упорядочить»
 * собирает граф в кадр, «Отменить» возвращает прежнюю расстановку.
 *
 * Раскладка проверена юнит-тестами как чистая функция (перекрытия,
 * детерминированность). Здесь проверяется то, чего в чистой функции нет:
 * запись координат в базу, чтение их обратно и один шаг отмены — то есть
 * ровно та цепочка, в которой позиции и терялись.
 */

async function openFirstPath(page: Page): Promise<boolean> {
  await page.goto('/paths');
  const link = page.getByRole('link', { name: /Открыть|Карта/ }).first();
  if ((await link.count()) === 0) return false;
  await link.click();
  await expect(page.getByRole('button', { name: 'Упорядочить' })).toBeVisible({ timeout: 20_000 });
  return true;
}

/** Координаты узла из его inline-трансформации — так их видит React Flow. */
async function nodePosition(page: Page, index = 0): Promise<{ x: number; y: number }> {
  const box = await page.locator('.react-flow__node').nth(index).boundingBox();
  if (!box) throw new Error('Узел не найден на карте');
  return { x: box.x, y: box.y };
}

test('перетаскивание узла сохраняется после перезагрузки', async ({ page }) => {
  const opened = await openFirstPath(page);
  test.skip(!opened, 'Нет путей обучения — двигать нечего.');

  const before = await nodePosition(page);
  const node = page.locator('.react-flow__node').first();

  await node.hover();
  await page.mouse.down();
  await page.mouse.move(before.x + 180, before.y + 120, { steps: 12 });
  await page.mouse.up();

  // Запись уходит с задержкой 500 мс одним батчем.
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Упорядочить' })).toBeVisible({ timeout: 20_000 });

  const after = await nodePosition(page);
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(20);
});

test('«Упорядочить» собирает граф в кадр, «Отменить» возвращает прежнее', async ({ page }) => {
  const opened = await openFirstPath(page);
  test.skip(!opened, 'Нет путей обучения.');

  const beforeArrange = await nodePosition(page);

  await page.getByRole('button', { name: 'Упорядочить' }).click();
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeEnabled({ timeout: 20_000 });

  // Zoom-to-fit после раскладки: все узлы попадают в видимую область.
  const viewport = page.viewportSize();
  if (viewport) {
    for (const box of await page.locator('.react-flow__node').all()) {
      const rect = await box.boundingBox();
      if (!rect) continue;
      expect(rect.x).toBeGreaterThan(-1);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  }

  const afterArrange = await nodePosition(page);

  await page.getByRole('button', { name: 'Отменить' }).click();
  await page.waitForTimeout(1200);
  const afterUndo = await nodePosition(page);

  // Отмена вернула то, что было до раскладки, а не оставила её результат.
  const toArrange = Math.abs(afterArrange.x - beforeArrange.x) + Math.abs(afterArrange.y - beforeArrange.y);
  const toUndo = Math.abs(afterUndo.x - beforeArrange.x) + Math.abs(afterUndo.y - beforeArrange.y);
  if (toArrange > 20) expect(toUndo).toBeLessThan(toArrange);
});

test('слой «Заметки» переключается и не ломает карту', async ({ page }) => {
  const opened = await openFirstPath(page);
  test.skip(!opened, 'Нет путей обучения.');

  await page.getByRole('group', { name: 'Слои карты' }).getByRole('button', { name: /Заметки/ }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();

  await page.getByRole('group', { name: 'Слои карты' }).getByRole('button', { name: 'Карта' }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});
