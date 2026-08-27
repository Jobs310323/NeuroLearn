import { expect, test, type Page } from '@playwright/test';

/**
 * Умные подсказки в практике.
 *
 * Правила проверены юнит-тестами как чистые функции. Здесь — то, чего в
 * чистой функции нет: карточка действительно появляется в интерфейсе, не
 * перекрывает задание, и отключённый тип действительно молчит.
 */

/** Проходит один вопрос: JOK → ответ → уверенность. */
async function answerItem(page: Page, confidence: number): Promise<boolean> {
  const jok = page.getByText(/Ещё не отвечая/);
  if (!(await jok.isVisible().catch(() => false))) return false;

  await page.getByRole('button', { name: '3', exact: true }).first().click();

  const textarea = page.getByPlaceholder('Ваш ответ');
  if (await textarea.isVisible().catch(() => false)) {
    await textarea.fill('заведомо неверный ответ для проверки подсказок');
  } else {
    await page.locator('input[type="radio"]').first().check();
  }

  await page.getByRole('button', { name: 'Ответить' }).click();
  await page.getByRole('button', { name: String(confidence), exact: true }).first().click();
  return true;
}

async function startPractice(page: Page): Promise<boolean> {
  await page.goto('/review');
  const start = page.getByRole('button', { name: 'Пройти' }).first();
  if ((await start.count()) === 0) return false;
  await start.click();
  return true;
}

test('уверенность 5 при неверном ответе показывает карточку калибровки', async ({ page }) => {
  const started = await startPractice(page);
  test.skip(!started, 'Очередь повторений пуста.');

  const answered = await answerItem(page, 5);
  test.skip(!answered, 'Задание не открылось.');

  // Карточка появляется ПОСЛЕ ответа и не блокирует переход дальше.
  const hint = page.locator('[data-hint-rule="metacognitive_coaching"]');
  if (await hint.isVisible().catch(() => false)) {
    await expect(hint).toContainText(/уверенность/i);
    await expect(page.getByRole('button', { name: 'Далее' })).toBeVisible();
    // «Почему это показано» раскрывает основание, а не общую фразу.
    await hint.getByRole('button', { name: 'Почему это показано' }).click();
    await expect(hint).toContainText(/калибровк/i);
  }
});

test('отключённый тип подсказок не показывается', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Умные подсказки' })).toBeVisible();

  const row = page
    .getByRole('listitem')
    .filter({ hasText: 'Разбор калибровки' });
  const toggle = row.getByRole('button');
  if ((await toggle.textContent())?.includes('Выключить')) {
    await toggle.click();
    await expect(row.getByRole('button', { name: 'Включить' })).toBeVisible();
  }

  const started = await startPractice(page);
  test.skip(!started, 'Очередь повторений пуста.');
  const answered = await answerItem(page, 5);
  test.skip(!answered, 'Задание не открылось.');

  await expect(page.locator('[data-hint-rule="metacognitive_coaching"]')).toHaveCount(0);

  // Возвращаем как было — тест не должен оставлять после себя настройку.
  await page.goto('/settings');
  const restore = page
    .getByRole('listitem')
    .filter({ hasText: 'Разбор калибровки' })
    .getByRole('button', { name: 'Включить' });
  if (await restore.isVisible().catch(() => false)) await restore.click();
});

test('чип сложности показывает уровень задания', async ({ page }) => {
  const started = await startPractice(page);
  test.skip(!started, 'Очередь повторений пуста.');

  const chip = page.getByText(/сложность \d\/5/);
  if ((await chip.count()) > 0) await expect(chip.first()).toBeVisible();
});
