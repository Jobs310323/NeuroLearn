import { expect, test } from '@playwright/test';

/**
 * Путь «вход → карта → чтение материала».
 *
 * Юнит-тестами он не покрывается принципиально: проверяется не правило, а
 * то, что цепочка серверных компонентов доходит до экрана — путь открылся,
 * карта отрисовалась, у узла с готовым материалом есть ссылка на чтение, и
 * по ней открывается содержимое, а не пустая страница.
 *
 * Тест пропускается, если в базе нет ни одного узла с `content_ready`:
 * это не поломка, а отсутствие данных — падать здесь было бы враньём.
 */

test('материал узла открывается с карты пути', async ({ page }) => {
  await page.goto('/paths');
  await expect(page.getByRole('heading', { name: 'Пути обучения' })).toBeVisible();

  const firstPath = page.locator('a[href^="/paths/"]').first();
  test.skip((await firstPath.count()) === 0, 'В базе нет ни одного пути обучения.');
  await firstPath.click();

  // Карта грузится клиентским React Flow — ждём именно узлы, а не заголовок.
  const nodes = page.locator('.react-flow__node');
  await expect(nodes.first()).toBeVisible({ timeout: 30_000 });

  // Узел с материалом ищем перебором: какой именно готов — зависит от
  // содержимого базы, и зашивать конкретный id в тест нельзя.
  const total = await nodes.count();
  let opened = false;
  for (let i = 0; i < total; i += 1) {
    await nodes.nth(i).click();
    const readLink = page.getByRole('link', { name: 'Читать материал' });
    if (await readLink.isVisible().catch(() => false)) {
      await readLink.click();
      opened = true;
      break;
    }
  }
  test.skip(!opened, 'Ни у одного узла нет сгенерированного материала (content_ready).');

  await page.waitForURL(/\/paths\/[^/]+\/nodes\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Блоки материала — то, ради чего экран существует. Пустой экран с одним
  // заголовком означает, что чтение сломано, а не что данных нет.
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
});
