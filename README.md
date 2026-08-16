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
| `npm run db:generate` | Сгенерировать миграцию из схемы |
| `npm run db:migrate` | Применить миграции (через HTTP-эндпоинт Neon) |
| `npx tsx scripts/db-reset.ts` | Сбросить схему `public` (только пустую базу) |

## Состояние

**Этап 0 — готов.** PRD, схема БД, структура директорий, API-контракты.

**Этап 1 — готов.** Каркас Next.js, Drizzle + Neon, аутентификация, CRUD путей
и узлов, интерактивная карта знаний на React Flow.

**Этапы 2–4 — впереди.** Генерация контента и ИИ-тьютор, движок практики
с FSRS, метакогниция и проекты.

## Требования к окружению

TypeScript зафиксирован на 6.x: Next.js 15 не поддерживает нативный компилятор
TypeScript 7 (нет JavaScript-компилятора API, который нужен сборке).
