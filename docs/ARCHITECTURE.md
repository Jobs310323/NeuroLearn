# NeuroLearn — архитектура

Сопровождает [PRD.md](../PRD.md). Здесь: стек, структура директорий, слои,
схема БД и правила границ.

---

## 1. Стек

| Слой | Технология | Примечание |
|------|-----------|-----------|
| Frontend | Next.js 15 (App Router, RSC), TypeScript `strict` | React 19 |
| Стили | TailwindCSS v4, shadcn/ui, Framer Motion | |
| Состояние | React Query (серверное), Zustand (UI-состояние карты и сессии) | |
| Граф | React Flow (`@xyflow/react`) + `elkjs` для авто-раскладки | |
| БД | Neon Postgres + Drizzle ORM + drizzle-kit | драйвер `neon-http` |
| Auth | Auth.js v5 (next-auth), JWT-сессии | личный режим: один владелец |
| AI | Vercel AI SDK v5, провайдер OpenRouter (fallback — Anthropic напрямую) | стриминг тьютора |
| Планировщик | `ts-fsrs` | SM-2 с нуля не пишем |
| Валидация | Zod v4 | обязательна на границе LLM и HTTP |
| Тесты | Vitest (unit), Playwright (e2e — с Этапа 3) | |

Разделение состояний строгое: React Query владеет всем, что пришло с сервера;
Zustand — только эфемерным UI (viewport карты, выделение узлов, черновик
ответа в открытой сессии). Дублирования серверных данных в Zustand нет.

## 2. Структура директорий

```
neurolearn/
├── PRD.md
├── docs/
│   ├── ARCHITECTURE.md
│   └── API.md
├── drizzle/                          # сгенерированные миграции + SQL для RLS
│   ├── 0000_init.sql
│   └── policies/                     # RLS-политики, применяются после миграции
├── drizzle.config.ts
└── src/
    ├── app/
    │   ├── (auth)/
    │   │   ├── login/page.tsx
    │   │   └── callback/route.ts
    │   ├── (app)/
    │   │   ├── layout.tsx            # сайдбар + виджет очереди повторений
    │   │   ├── dashboard/page.tsx
    │   │   ├── paths/
    │   │   │   ├── page.tsx
    │   │   │   ├── new/page.tsx      # постановка цели -> генерация дерева
    │   │   │   └── [pathId]/
    │   │   │       ├── page.tsx      # карта знаний (React Flow)
    │   │   │       └── nodes/[nodeId]/
    │   │   │           ├── page.tsx  # модуль: 10 блоков
    │   │   │           └── practice/page.tsx
    │   │   ├── review/page.tsx       # очередь FSRS
    │   │   ├── reflect/page.tsx      # дневник обучения
    │   │   ├── projects/[projectId]/page.tsx
    │   │   └── analytics/page.tsx    # knowledge_strength, time_to_mastery
    │   └── api/
    │       ├── paths/…               # см. docs/API.md
    │       ├── practice/…
    │       ├── review/…
    │       ├── tutor/chat/route.ts   # стриминг (Vercel AI SDK)
    │       └── ai/generate/…/route.ts
    │
    ├── features/                     # вертикальные срезы; между собой не импортируются
    │   ├── knowledge-map/
    │   │   ├── components/           # KnowledgeMap, NodeCard, EdgeTypes, MapLegend
    │   │   ├── hooks/                # useMapLayout, useNodeSelection
    │   │   ├── lib/                  # toReactFlow(), elkLayout(), statusColors()
    │   │   └── actions.ts            # Server Actions: create/update/move узлов
    │   ├── learning-path/
    │   ├── content/                  # рендер 10 блоков модуля
    │   ├── practice/                 # движок тестирования, instant/delayed
    │   ├── review/                   # очередь FSRS, кнопки оценки
    │   ├── tutor/                    # чат, сократический UI
    │   ├── reflection/               # дневник, чек-листы
    │   ├── projects/                 # сдача и защита
    │   └── analytics/
    │
    ├── components/
    │   ├── ui/                       # shadcn/ui, без бизнес-логики
    │   └── science-hint.tsx          # тултип «Почему мы так делаем?»
    │
    ├── lib/
    │   ├── db/
    │   │   ├── index.ts              # клиент Drizzle (pooler)
    │   │   ├── schema/               # ИСТОЧНИК ИСТИНЫ схемы
    │   │   └── queries/              # переиспользуемые селекты (только чтение)
    │   ├── services/                 # ВСЯ бизнес-логика, без React и без HTTP
    │   │   ├── fsrs/                 # scheduler.ts, mapping.ts, queue.ts
    │   │   ├── practice/             # selector.ts (интерливинг), grader.ts, feedback.ts
    │   │   ├── mastery/              # strength.ts, automaticity.ts, transitions.ts
    │   │   ├── metacognition/        # calibration.ts
    │   │   └── content/              # module-pipeline.ts (10 блоков)
    │   ├── ai/
    │   │   ├── provider.ts           # OpenRouter / Anthropic
    │   │   ├── agents/               # content-generator.ts, tutor.ts, …
    │   │   ├── prompts/              # версионированные системные промпты
    │   │   ├── tools/                # socratic-method.ts, emit-nodes.ts, …
    │   │   ├── context.ts            # чтение/запись user_context
    │   │   └── schemas.ts            # Zod-схемы выходов LLM
    │   ├── science/citations.ts      # реестр исследований для тултипов
    │   ├── supabase/                 # server.ts, client.ts, middleware.ts
    │   ├── validation/               # Zod-схемы HTTP-входов
    │   └── utils.ts
    │
    ├── stores/                       # Zustand: map-store.ts, session-store.ts
    ├── types/
    └── test/                         # фикстуры и хелперы Vitest
```

### Правила границ

1. `features/*` не импортируют друг друга. Общее уезжает в `lib/` или `components/`.
2. `lib/services/*` — чистый TypeScript: без `react`, без `next/*`, без чтения
   `cookies()`. Всё, что нужно, принимает аргументами. Отсюда — тестируемость.
3. Route Handlers и Server Actions — тонкие: парсинг Zod → вызов сервиса →
   сериализация. Логики в них нет.
4. `lib/db/queries/*` только читают. Записи — в сервисах, в транзакции.
5. Импорт `lib/db` из клиентских компонентов запрещён (проверяется ESLint-правилом
   `no-restricted-imports`).

## 3. Слои запроса

```
RSC page ──► lib/db/queries ──► Postgres            (чтение, без клиентского JS)
   │
   └─► client component ──► React Query ──► /api/* ──► Zod ──► lib/services ──► Drizzle
                                                                    │
Server Action ──────────────────────────────► Zod ──────────────────┘
```

Правило выбора: мутация, привязанная к форме и странице → Server Action.
Мутация, которую дёргает интерактивный клиент часто и вне формы (ответ на
вопрос, оценка FSRS) или требующая стриминга → Route Handler.

## 3a. База данных: Neon и следствия

Проект работает на Neon, а не на Supabase. Что из этого следует:

- **Драйвер `neon-http`.** Порт 5432 и WebSocket закрыты в части сетей
  (в том числе на машине разработки), HTTPS-эндпоинт доступен везде и
  работает в edge-рантайме.
- **Нет интерактивных транзакций.** `db.transaction(async tx => …)` в
  HTTP-режиме недоступен. Атомарность — через `db.batch([...])`: Neon
  выполняет список запросов одной транзакцией. Правило для сервисов:
  сначала все чтения, затем расчёт в JS, затем один `batch` с записями.
- **Повторы только для чтений.** Обрыв соединения случается и после
  успешного выполнения запроса — ответ теряется, работа сделана. Слепой
  повтор `INSERT` создаёт дубль, поэтому `src/lib/db/index.ts` повторяет
  только `SELECT`/`WITH`. Скрипты сопровождения пишут идемпотентно
  (id генерируются на клиенте + `onConflictDoNothing`) и включают повтор
  записей флагом `NEURO_DB_RETRY_WRITES=1`.
- **Миграции — `npm run db:migrate`** (`scripts/migrate.ts`), а не
  `drizzle-kit migrate`: штатный мигратор ходит по WebSocket, а HTTP-вариант
  Drizzle шлёт весь файл одним запросом и обрывается на больших миграциях.
  Наш скрипт выполняет операторы по одному, ведёт совместимый журнал
  `drizzle.__drizzle_migrations` и терпит потерю ответа.
- **Нет RLS.** Она была следствием прямого доступа клиента к Supabase.
  Здесь клиент в БД не ходит вообще: все запросы идут через Server Actions
  и Route Handlers, `userId` берётся только из сессии. Проверка владения —
  в коде (`assertPathOwner`, `pathIdOfNode`), а не в политиках.
- **Нет объектного хранилища.** Импортируемые PDF и конспекты разбираются
  в текст, оригиналы не сохраняются — только `source_documents` и
  `source_chunks`. Поиск по источникам полнотекстовый (GIN по `to_tsvector`),
  без векторов и платных embedding-API.

## 3b. Аутентификация

Приложение личное, регистрации нет. Auth.js v5 с двумя провайдерами:

- `owner` (Credentials) — логин и пароль из `AUTH_OWNER_LOGIN` /
  `AUTH_OWNER_PASSWORD`, сравнение через `timingSafeEqual` по SHA-256.
  Разбор окружения и сверка вынесены в `src/lib/auth/owner.ts`, чтобы у
  входа, e2e-прогонов и служебных скриптов был один источник правды.
  Идентификатором принимается и логин, и `AUTH_OWNER_EMAIL`: обе проверки
  выполняются всегда, без короткого замыкания по `||`.
- `github` (OAuth) — включается автоматически при заданных
  `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`; вход разрешён только адресу
  владельца.

Сессии — JWT (Credentials несовместим с адаптером БД), поэтому таблиц
Auth.js в схеме нет: строка в `users` создаётся при первом входе.
Middleware не используется — проверка идёт в layout `(app)` через
`requireUserId()`, что избавляет от разделения конфигов на edge и node.

## 4. Схема БД (21 таблица)

Источник истины — `src/lib/db/schema/`. Диаграмма:

```
users
 ├─< learning_paths
 │      └─< knowledge_nodes ──self──┐ (parent_id: дерево)
 │             │                    │
 │             ├─< node_edges >─────┘ (граф: prerequisite/related/contrast/analogous)
 │             ├─── node_progress (1:1)  knowledge_strength, time_to_mastery
 │             ├─< content_blocks ──< assessments
 │             ├─< fsrs_cards ──< review_logs
 │             └─< projects ──< project_submissions
 │
 ├─< practice_sessions ──< user_responses >── assessments
 ├─< reflections
 ├─< user_context                  (общая доска 4 агентов)
 ├─< tutor_conversations ──< tutor_messages
 ├─< ai_generations                (аудит вызовов LLM)
 └─< source_documents ──< source_chunks ──< node_sources >── knowledge_nodes
```

| Файл схемы | Таблицы |
|-----------|---------|
| `enums.ts` | 16 pg-энумов |
| `users.ts` | `users` |
| `learning.ts` | `learning_paths`, `knowledge_nodes`, `node_edges`, `node_progress` |
| `content.ts` | `content_blocks`, `assessments` |
| `practice.ts` | `practice_sessions`, `user_responses` |
| `fsrs.ts` | `fsrs_cards`, `review_logs` |
| `metacognition.ts` | `reflections` |
| `agents.ts` | `user_context`, `tutor_conversations`, `tutor_messages`, `ai_generations` |
| `projects.ts` | `projects`, `project_submissions` |
| `sources.ts` | `source_documents`, `source_chunks`, `node_sources` |

### Инварианты на уровне БД (CHECK-констрейнты)

- `content_blocks`: `(type = 'pre_assessment') = pre_assessment` — флаг не
  может разойтись с типом.
- `assessments`: `instant_feedback <> delayed_feedback` и
  `(feedback_mode = 'instant') = instant_feedback`.
- `user_responses`: `confidence_level` ∈ [1,5], `partial_score` ∈ [0,1],
  `response_time_ms ≥ 0`.
- `knowledge_nodes`: `weight`, `difficulty` ∈ [0,1]; `parent_id <> id`.
- `node_edges`: `source_id <> target_id`, `strength` ∈ [0,1].
- `node_progress`: `knowledge_strength` ∈ [0,100].
- `fsrs_cards`: `stability ≥ 0`, `difficulty` ∈ [0,10] (диапазон FSRS).

Ацикличность графа `node_edges` по типу `prerequisite` БД не гарантирует —
проверяется рекурсивным CTE в `lib/services/graph/acyclic.ts` перед вставкой.

### Изоляция данных

RLS нет (см. §3a). Гарантии дают три правила:

- `userId` берётся только из сессии (`requireUserId`), никогда из тела запроса.
- Любая операция с узлом проходит через `assertPathOwner` или `pathIdOfNode` —
  проверку цепочки владения до `learning_paths.user_id`.
- `assessments.correct_answer` не покидает сервер: запросы для клиента не
  выбирают эту колонку, проверка ответа целиком в `lib/services/practice/grader.ts`.

## 5. Тестирование

| Что | Чем | Обязательность |
|-----|-----|---------------|
| Маппинг `fsrs_state`/`fsrs_rating` ↔ `State`/`Rating` из ts-fsrs | Vitest | обязательно |
| Планирование FSRS: сохранение/восстановление `Card`, `rollback` | Vitest | обязательно |
| `grader.ts` — проверка ответа по каждому типу `assessment_type` | Vitest, табличные кейсы | обязательно |
| `selector.ts` — интерливинг: доля смеси, отсутствие двух вариантов одной группы | Vitest | обязательно |
| `strength.ts` / `transitions.ts` — формулы и переходы статусов | Vitest | обязательно |
| Zod-схемы выходов LLM на зафиксированных примерах ответов | Vitest | обязательно |
| Ключевые пути UI | Playwright | с Этапа 3 |

## 6. Наблюдаемость

- `ai_generations` — стоимость и латентность каждого вызова LLM, доля
  `schema_failed` по версиям промптов.
- `review_logs` — полная история повторений, позволяет переиграть расписание
  при смене параметров FSRS.
- Клиентские ошибки и Web Vitals — Vercel Analytics.
