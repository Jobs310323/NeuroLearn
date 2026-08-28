import { expect, test as setup } from '@playwright/test';

/**
 * Вход владельца один раз на весь прогон; состояние сессии сохраняется в
 * файл и переиспользуется остальными проектами (`storageState`).
 *
 * Логин и пароль берутся из `.env.local` (те же `AUTH_OWNER_LOGIN` /
 * `AUTH_OWNER_PASSWORD`, что читает `src/lib/auth/index.ts`) и в репозиторий
 * не попадают: ни здесь, ни в сохранённом состоянии — там только cookie
 * сессии. Файл состояния лежит в `e2e/.auth/`, каталог в `.gitignore`.
 */

const STATE_PATH = 'e2e/.auth/owner.json';

setup('вход владельца', async ({ page }) => {
  // Тот же порядок разбора, что в `src/lib/auth/owner.ts`: логин, иначе почта,
  // иначе значение по умолчанию.
  const login = process.env.AUTH_OWNER_LOGIN ?? process.env.AUTH_OWNER_EMAIL ?? 'admin';
  const password = process.env.AUTH_OWNER_PASSWORD;

  // Отдельная явная ошибка вместо падения на пустом поле формы: без пароля
  // вход по нему в приложении вообще не включается
  // (`src/lib/auth/index.ts`), и «неверный пароль» увёл бы не туда.
  if (!password) {
    throw new Error(
      'Для E2E нужен AUTH_OWNER_PASSWORD в .env.local — ' +
        'это та же переменная, которой включается вход по паролю.',
    );
  }

  await page.goto('/login');
  await page.locator('#login').fill(login);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('link', { name: 'Повторение' })).toBeVisible();

  await page.context().storageState({ path: STATE_PATH });
});
