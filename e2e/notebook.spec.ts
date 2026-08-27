import { expect, test, type Page } from '@playwright/test';

/**
 * Тетрадь: правка без сети не теряется и доезжает до сервера.
 *
 * Юнит-тесты проверяют решения (`note-sync.ts`, `conflict.ts`), но не
 * проверяют связку «браузер без сети → IndexedDB → очередь → сервер»: в
 * node-окружении нет ни событий `offline`/`online`, ни localforage. Именно
 * на этом стыке текст и пропадал бы незаметно.
 */

/** Читает размер очереди заметок прямо из IndexedDB — как `pendingNoteCount()`. */
async function pendingNotes(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('neurolearn');
        request.onerror = () => reject(new Error('IndexedDB недоступна'));
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('pending_notes')) {
            database.close();
            resolve(0);
            return;
          }
          const count = database
            .transaction('pending_notes', 'readonly')
            .objectStore('pending_notes')
            .count();
          count.onsuccess = () => {
            database.close();
            resolve(count.result);
          };
          count.onerror = () => {
            database.close();
            reject(new Error('Не удалось прочитать очередь заметок'));
          };
        };
      }),
  );
}

test('заметка, написанная офлайн, уходит на сервер при возврате сети', async ({
  page,
  context,
}) => {
  await page.goto('/notes');
  await expect(page.getByRole('heading', { name: 'Рабочая тетрадь' })).toBeVisible();

  // Заметка создаётся онлайн — офлайн проверяется правка, самый частый случай.
  await page.getByRole('button', { name: 'Записать' }).click();
  await expect(page.getByLabel('Текст заметки')).toBeVisible();

  const marker = `офлайн-проверка ${Date.now()}`;

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));

  await page.getByLabel('Заголовок заметки').fill(marker);
  await page.getByLabel('Текст заметки').fill('Текст, написанный без сети.');
  await page.getByLabel('Текст заметки').blur();

  // Экран честно говорит, что правка в очереди, а не «сохранено».
  await expect(page.getByText(/в очереди, текст не потерян/)).toBeVisible();
  expect(await pendingNotes(page)).toBeGreaterThan(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(page.getByText(/Отправлено заметок/)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => pendingNotes(page), { timeout: 15_000 }).toBe(0);

  // Заметка на месте после полной перезагрузки — значит, дошла до базы.
  await page.reload();
  await page.getByLabel('Поиск по тетради').fill(marker);
  await expect(page.getByRole('button', { name: new RegExp(marker) })).toBeVisible({
    timeout: 15_000,
  });
});

test('поиск по тетради работает без участия модели', async ({ page }) => {
  await page.goto('/notes');

  const marker = `интерливинг ${Date.now()}`;
  await page.getByRole('button', { name: 'Записать' }).click();
  await page.getByLabel('Заголовок заметки').fill(marker);
  await page.getByLabel('Текст заметки').fill('Перемешивать темы, а не блокировать одну.');
  await page.getByLabel('Текст заметки').blur();
  await expect(page.getByText('сохранено')).toBeVisible();

  // Поиск по началу слова — префиксный `tsquery`, не точное совпадение.
  await page.getByLabel('Поиск по тетради').fill('интерл');
  await expect(page.getByRole('button', { name: new RegExp(marker) })).toBeVisible({
    timeout: 10_000,
  });
});
