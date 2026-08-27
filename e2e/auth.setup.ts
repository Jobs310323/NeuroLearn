import { expect, test as setup } from '@playwright/test';

/**
 * Вход владельца один раз на весь прогон; состояние сессии сохраняется в
 * файл и переиспользуется остальными проектами (`storageState`).
 *
 * Пароль берётся из `.env.local` (те же `AUTH_OWNER_EMAIL` /
 * `AUTH_OWNER_PASSWORD`, что читает `src/lib/auth/index.ts`) и в репозиторий
 * не попадает: ни здесь, ни в сохранённом состоянии — там только cookie
 * сессии. Файл состояния лежит в `e2e/.auth/`, каталог в `.gitignore`.
 */

const STATE_PATH = 'e2e/.auth/owner.json';

setup('вход владельца', async ({ page }) => {
  const email = process.env.AUTH_OWNER_EMAIL;
  const password = process.env.AUTH_OWNER_PASSWORD;

  // Отдельная явная ошибка вместо падения на пустом поле формы: без этих
  // переменных вход по паролю в приложении вообще не включается
  // (`src/lib/auth/index.ts`), и «неверный пароль» увёл бы не туда.
  if (!email || !password) {
    throw new Error(
      'Для E2E нужны AUTH_OWNER_EMAIL и AUTH_OWNER_PASSWORD в .env.local — ' +
        'это те же переменные, которыми включается вход по паролю.',
    );
  }

  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('link', { name: 'Повторение' })).toBeVisible();

  await page.context().storageState({ path: STATE_PATH });
});
