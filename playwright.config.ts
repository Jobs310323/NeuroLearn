import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local' });

/**
 * E2E-проверки против живого приложения.
 *
 * Отдельно от Vitest намеренно. Юнит-тесты офлайн и мокают базу: они
 * проверяют правила, а не работу системы целиком. Здесь наоборот — настоящий
 * дев-сервер, настоящая база, настоящая сессия. Это ровно те три пути,
 * которые юнит-тестами не проверяются и которые ломались чаще всего:
 * вход и чтение материала, полный проход сессии практики, офлайн-оценка
 * с последующей синхронизацией.
 *
 * В CI не запускается: нужна настоящая база с данными обучения, а класть
 * рабочую строку подключения в секреты репозитория ради этого не стоит.
 * Запуск локальный: `npm run e2e`.
 *
 * Браузер ставится один раз: `npx playwright install chromium`.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // Один воркер и никакой параллельности: база одна, пользователь один, и
  // сессии практики друг другу мешают — параллельный прогон дал бы гонки
  // не про код, а про общий стейт.
  workers: 1,
  fullyParallel: false,
  // Повтор один и только в CI-подобном режиме: локально мигающий тест
  // полезнее видеть красным сразу.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    // Артефакты только по факту падения: успешный прогон не должен
    // засорять диск видео и трассировками.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'ru-RU',
  },

  projects: [
    // Вход выполняется один раз, состояние сессии переиспользуется —
    // иначе каждый файл логинился бы заново, а Credentials-провайдер
    // next-auth на это отвечает медленно.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/owner.json' },
      dependencies: ['setup'],
    },
  ],

  // Сервер поднимается сам, если на порту ещё пусто. `reuseExistingServer`
  // важен при локальной отладке: держать уже запущенный `npm run dev` и
  // гонять тесты по нему быстрее, чем перезапускать сборку на каждый прогон.
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
