# NeuroLearn

Веб-приложение, которое не передаёт знания, а выстраивает навык через практику
до уровня автоматизма.

## Документы

| Файл | Что внутри |
|------|-----------|
| [PRD.md](./PRD.md) | Научные основы, метрики, границы этапов. **Читать первым.** |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Стек, структура директорий, схема БД, правила границ |
| [docs/API.md](./docs/API.md) | Контракты Server Actions и Route Handlers |

## Стек

Next.js 15 (App Router, RSC) · TypeScript strict · TailwindCSS v4 · React Flow ·
Neon Postgres + Drizzle ORM · Auth.js v5 · React Query + Zustand · Vitest.

## Запуск

```bash
npm install
```

Скопировать `.env.example` в `.env.local` и заполнить: строку подключения Neon,
`AUTH_SECRET`, `AUTH_OWNER_EMAIL`, `AUTH_OWNER_PASSWORD`.

```bash
npm run db:migrate
```

Один раз поставить git-хук, отклоняющий коммит с секретом (`.githooks/pre-commit`;
хук проверяет содержимое индекса, не всё дерево):

```bash
npm run hooks:install
```

```bash
npm run dev
```

Демонстрационное дерево знаний:

```bash
npx tsx scripts/seed-demo.ts
```

## Команды

| Команда | Действие |
|---------|----------|
| `npm run dev` | Дев-сервер |
| `npm run typecheck` | Проверка типов |
| `npm test` | Unit-тесты (Vitest) |
| `npm run hooks:install` | Включить git-хуки из `.githooks` (скан секретов перед коммитом) |
| `npm run check-env` | Проверить переменные окружения и показать, что выключено |
| `npm run test:providers` | Настоящий вызов к каждому настроенному провайдеру моделей |
| `npm run test:models -- groq:openai/gpt-oss-120b` | Замер конкретных моделей, отчёт в `model-benchmark.json` |
| `npm run test:alert` | Тестовое сообщение в `ALERT_WEBHOOK_URL` |
| `npm run setup:upstash` | Показать базы Upstash и переменные для лимита запросов |
| `npm run fsrs:force-optimize` | Прогон пути переоптимизации весов FSRS с пониженным порогом |
| `npm run generate:pm` | Сгенерировать контент для узлов пути «Продакт-менеджмент» |
| `npm run db:generate` | Сгенерировать миграцию из схемы |
| `npm run db:migrate` | Применить миграции (через HTTP-эндпоинт Neon) |
| `npx tsx scripts/db-reset.ts` | Сбросить схему `public` (только пустую базу) |

## Ручные настройки

Всё, что нельзя сделать из кода: завести учётку, выпустить ключ, отозвать
старый. Приложение работает и без пунктов 2–5, но каждый из них что-то
выключает — `npm run check-env` печатает, что именно.

### 1. Провайдер моделей (обязательно хотя бы один)

Ключ кладётся **в `.env.local`** — файл в `.gitignore`, в репозиторий не
попадает. Пересылать ключ в переписке или вставлять в чат не нужно ни при
каких обстоятельствах: попавший в переписку ключ считается скомпрометированным
и подлежит отзыву.

| Провайдер | Где выпустить ключ | Переменная | Замечания |
|---|---|---|---|
| Groq | https://console.groq.com/keys | `GROQ_API_KEY` | Бесплатный тариф, самый быстрый ответ (~1 с). Структурированный вывод держит только линейка `gpt-oss` |
| Cerebras | https://cloud.cerebras.ai/platform/apikeys | `CEREBRAS_API_KEY` | Самый быстрый инференс, но **счёт нужно активировать**: иначе `Payment Required` на любую модель, хотя список моделей отдаётся |
| Mistral | https://console.mistral.ai/api-keys | `MISTRAL_API_KEY` | Бесплатный тариф, все `mistral-*` проверены |
| OpenRouter | https://openrouter.ai/keys | `OPENROUTER_API_KEY` | Бесплатные модели с суффиксом `:free`, медленнее остальных |
| DeepSeek | https://platform.deepseek.com/api_keys | `DEEPSEEK_API_KEY` | **Платный**, с предоплатой: без пополнения счёта отвечает `Insufficient Balance` |
| Together AI | https://api.together.ai/settings/api-keys | `TOGETHER_API_KEY` | Не проверялся: ключ, который был под рукой, отвергался как недействительный |
| Google AI Studio | https://aistudio.google.com/apikey | `GOOGLE_GENERATIVE_AI_API_KEY` | Бесплатный тариф Gemini, в ряде стран недоступен |

`AI_PROVIDER` задавать не обязательно — основным станет первый провайдер
с ключом, остальные автоматически станут резервом. После настройки:

```bash
npm run test:providers
```

### 2. Прокси (только если интернет идёт через него)

Node не читает `HTTP_PROXY`/`HTTPS_PROXY` сам, в отличие от curl, git и npm.
Приложение включает их поддержку явно (`src/lib/net/proxy.ts`), но сами
переменные должны быть в окружении. Без этого запросы к провайдерам уходят
напрямую и возвращают 403 — выглядит как блокировка на их стороне, хотя дело
в своей же настройке.

### 3. Лимит запросов (Upstash Redis)

Без него AI-роуты в production отвечают ошибкой — это сделано намеренно, чтобы
выключенная защита не выглядела работающей.

1. Завести бесплатную базу: https://console.upstash.com/redis
2. Скопировать со страницы базы `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`.
3. Положить обе в `.env.local` и в переменные окружения Vercel.

Второй и третий шаги умеет делать `npm run setup:upstash` — для этого нужны
`UPSTASH_EMAIL` (почта аккаунта) и `UPSTASH_MANAGEMENT_API_KEY` (Account →
Management API, это не ключ базы). Без аргументов скрипт только читает: покажет
базы аккаунта и напечатает готовые строки. Создать базу — `-- --create <имя>`,
отдельным флагом, потому что это заведение ресурса в вашем аккаунте.

Если лимит не нужен осознанно (установка на одного человека) — вместо этого
`RATE_LIMIT_DISABLED=1`.

### 4. Оповещения о критичных ошибках

`ALERT_WEBHOOK_URL` — любой адрес, принимающий POST с JSON `{ text }`:

- Slack: входящий вебхук, https://api.slack.com/messaging/webhooks
- Telegram: `https://api.telegram.org/bot<токен>/sendMessage?chat_id=<id>&text=`

Проверка — `npm run test:alert`.

### 5. Секрет для cron

`CRON_SECRET` обязателен в production: без него `/api/cron/*` отвечает 500.
Значение генерируется так же, как `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

На Vercel переменную достаточно задать в настройках проекта — заголовок
`Authorization: Bearer <секрет>` платформа подставляет своим запросам сама.

### 6. Ротация секретов

Ключ, который хоть раз попал в переписку, лог или скриншот, считается
скомпрометированным. Порядок один и тот же для всех:

1. В панели провайдера выпустить новый ключ.
2. Заменить значение в `.env.local` и в переменных окружения Vercel.
3. Удалить старый ключ в панели — именно удалить, а не оставить «на всякий случай».
4. Проверить: `npm run check-env`, затем `npm run test:providers`.

Отдельные случаи:

- **Пароль базы Neon** — Neon Console, роль базы, «Reset password». Затем
  обновить `DATABASE_URL` в обоих местах.
- **`AUTH_SECRET`** — смена разлогинивает все сессии, это нормально.
- **`VERCEL_OIDC_TOKEN`** в `.env.local` ротировать не нужно: он короткоживущий
  и перевыпускается командой `vercel env pull`.

## Состояние

**Этап 0 — готов.** PRD, схема БД, структура директорий, API-контракты.

**Этап 1 — готов.** Каркас Next.js, Drizzle + Neon, аутентификация, CRUD путей
и узлов, интерактивная карта знаний на React Flow.

**Этапы 2–4 — впереди.** Генерация контента и ИИ-тьютор, движок практики
с FSRS, метакогниция и проекты.

## Требования к окружению

TypeScript зафиксирован на 6.x: Next.js 15 не поддерживает нативный компилятор
TypeScript 7 (нет JavaScript-компилятора API, который нужен сборке).
