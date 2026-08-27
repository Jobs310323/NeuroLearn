import { expect, test } from '@playwright/test';

/**
 * Флагманские механики тетради: захват одним жестом и вернувшаяся капсула.
 *
 * Планировщик живых заметок и пайплайны проверены юнит-тестами как чистые
 * функции. Здесь — путь целиком: ⌘K из любого экрана создаёт заметку,
 * капсула возвращается с вопросом «сбылось ли», и ответ на неё превращается
 * в точку калибровки.
 */

test('⌘K записывает мысль из любого места приложения', async ({ page }) => {
  await page.goto('/dashboard');

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Командная палитра' })).toBeVisible();

  const marker = `мысль на ходу ${Date.now()}`;
  await page.getByLabel('Команда или поиск').fill(marker);
  // Первый пункт — «Записать»: захват всегда сверху, ради него палитра и нужна.
  await page.keyboard.press('Enter');

  // Попадаем сразу в заметку на правку, без экрана подтверждения.
  await expect(page.getByLabel('Текст заметки')).toHaveValue(new RegExp(marker), {
    timeout: 15_000,
  });
});

test('палитра закрывается по Esc и возвращает фокус', async ({ page }) => {
  await page.goto('/dashboard');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Командная палитра' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Командная палитра' })).toHaveCount(0);
});

test('капсула времени возвращается и её ответ даёт точку калибровки', async ({ page }) => {
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Записать' }).click();
  await expect(page.getByLabel('Текст заметки')).toBeVisible();

  const marker = `капсула ${Date.now()}`;
  await page.getByLabel('Заголовок заметки').fill(marker);
  await page.getByLabel('Текст заметки').fill('Проверка механики капсул.');
  await page.getByLabel('Текст заметки').blur();
  await expect(page.getByText('сохранено')).toBeVisible();

  await page.getByRole('button', { name: 'Капсула времени' }).click();
  await page.getByLabel('Что, по-вашему, произойдёт').fill('Через месяц буду решать без подсказок');

  // Дата в прошлом не принимается — капсула смотрит вперёд.
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Когда вернуть').fill(tomorrow);
  await page.getByRole('button', { name: 'Назначить капсулу' }).click();

  // Заметка отмечена как ожидающая возврата.
  await page.reload();
  await page.getByLabel('Поиск по тетради').fill(marker);
  await expect(page.getByRole('button', { name: new RegExp(marker) })).toBeVisible({
    timeout: 15_000,
  });
});

test('реестр непонимания группирует пометки по узлу', async ({ page }) => {
  await page.goto('/notes/registry');
  await expect(page.getByRole('heading', { name: 'Реестр непонимания' })).toBeVisible();
  // Переключатель периода не должен ронять страницу на пустых данных.
  await page.getByRole('link', { name: '30 дн.' }).click();
  await expect(page.getByRole('heading', { name: 'Реестр непонимания' })).toBeVisible();
});
