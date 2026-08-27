import { expect, test } from '@playwright/test';

/**
 * Полный проход сессии практики до отчёта.
 *
 * Смысл теста — цепочка, которую нельзя собрать из юнит-тестов:
 * `GET /practice/next` → `POST /sessions` → серия `POST .../responses` →
 * `POST .../complete` → экран итога. Каждое звено покрыто отдельно, но
 * ломалась именно склейка: несовпадение порядка заданий, потерянный
 * `sessionId`, отчёт без данных.
 *
 * Заодно проверяется двухшаговый ввод (Фаза 0, п. 2): кнопка «Ответить»
 * останавливает таймер и только потом появляется шкала уверенности. Если
 * шаги снова схлопнут в один, тест упадёт на отсутствии шкалы.
 */

test('сессия практики доходит до отчёта', async ({ page }) => {
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Очередь повторений' })).toBeVisible();

  const start = page.getByRole('button', { name: 'Пройти' }).first();
  test.skip((await start.count()) === 0, 'Очередь повторений пуста — проходить нечего.');
  await start.click();

  // Подбор заданий идёт двумя запросами к серверу; ждём первый вопрос.
  const answerButton = page.getByRole('button', { name: 'Ответить' });
  await expect(answerButton).toBeVisible({ timeout: 30_000 });

  // Идём по заданиям, пока не покажется экран итога. Верхняя граница — на
  // случай, если «Далее» перестанет продвигать сессию: без неё тест висел бы
  // до общего таймаута вместо внятного падения.
  const MAX_ITEMS = 30;
  for (let i = 0; i < MAX_ITEMS; i += 1) {
    if (await page.getByText('Сессия завершена').isVisible().catch(() => false)) break;

    await answerText(page);

    await expect(answerButton).toBeEnabled();
    await answerButton.click();

    // Шкала уверенности — отдельный шаг после остановки таймера.
    const confidence = page.getByRole('button', { name: '4', exact: true });
    await expect(confidence).toBeVisible();
    await confidence.click();

    const next = page.getByRole('button', { name: /Далее|Завершить/ });
    await expect(next).toBeVisible({ timeout: 20_000 });
    await next.click();
  }

  await expect(page.getByText('Сессия завершена')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Точность:/)).toBeVisible();
  // Пересчёт прогресса по узлу — то, ради чего сессия и завершается.
  await expect(page.getByText('Прочность знания').first()).toBeVisible();
});

/**
 * Заполняет ответ, каким бы ни был тип задания. Правильность неважна:
 * тест проверяет проходимость цепочки, а не оценку — её считает `grader.ts`,
 * и он покрыт юнит-тестами.
 */
async function answerText(page: import('@playwright/test').Page): Promise<void> {
  const radio = page.locator('input[type="radio"]').first();
  if (await radio.isVisible().catch(() => false)) {
    await radio.check();
    return;
  }

  const checkbox = page.locator('input[type="checkbox"]').first();
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.check();
    return;
  }

  await page.locator('textarea').first().fill('Ответ для проверки прохождения сессии.');
}
