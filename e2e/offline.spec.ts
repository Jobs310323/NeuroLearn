import { expect, test } from '@playwright/test';

/**
 * Офлайн-оценка и синхронизация при возврате в сеть.
 *
 * Из всех путей приложения этот проверяется только так. Он состоит из
 * событий браузера (`offline`/`online`), IndexedDB через localforage и
 * отправки очереди — ни одно из трёх не воспроизводится в node-окружении
 * Vitest, а именно здесь терялись повторения: оценка ставилась офлайн и
 * не доезжала до сервера.
 *
 * Проверяются оба конца: запись легла в очередь и очередь опустела после
 * возвращения сети. Пустая очередь без первого шага ничего не доказывает —
 * она пуста и когда оценка вообще не сохранилась.
 */

/** Читает счётчик очереди прямо из IndexedDB — так же, как `pendingGradeCount()`. */
async function pendingCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('neurolearn');
        request.onerror = () => reject(new Error('IndexedDB недоступна'));
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('pending_grades')) {
            database.close();
            resolve(0);
            return;
          }
          const count = database.transaction('pending_grades', 'readonly').objectStore('pending_grades').count();
          count.onsuccess = () => {
            database.close();
            resolve(count.result);
          };
          count.onerror = () => {
            database.close();
            reject(new Error('Не удалось прочитать очередь'));
          };
        };
      }),
  );
}

test('оценка, поставленная офлайн, уходит на сервер при возврате сети', async ({ page, context }) => {
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Очередь повторений' })).toBeVisible();

  const hasCards = (await page.getByRole('button', { name: 'Пройти' }).count()) > 0;
  test.skip(!hasCards, 'Очередь повторений пуста — оценивать нечего.');

  const before = await pendingCount(page);

  await context.setOffline(true);
  // Событие `offline` слушает `useOnlineStatus` в review-queue.tsx;
  // Playwright сам его не диспатчит при setOffline.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));

  await expect(page.getByText(/Нет сети/)).toBeVisible();

  // Офлайн вместо «Пройти» показываются четыре оценки по памяти.
  await page.getByRole('button', { name: 'Вспомнил' }).first().click();
  await expect(page.getByText('Оценено, ждёт синхронизации').first()).toBeVisible();

  expect(await pendingCount(page)).toBe(before + 1);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // `registerSyncOnReconnect` отправляет очередь по событию `online`.
  await expect.poll(() => pendingCount(page), { timeout: 20_000 }).toBe(0);
});
