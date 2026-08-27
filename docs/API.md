# NeuroLearn — API-контракты

Дополняет [ARCHITECTURE.md](./ARCHITECTURE.md).

Общие правила:

- Все `id` — UUID v4. Все даты — ISO 8601 в UTC.
- Вход валидируется Zod (`src/lib/validation/`). Схема — часть контракта.
- Аутентификация: cookie-сессия Supabase. Каждый обработчик получает
  `userId` из сессии; `user_id` **никогда** не принимается из тела запроса.
- Ошибка: `{ "error": { "code": string, "message": string, "details"?: unknown } }`
  с HTTP-кодом. `code` — стабильный машинный ключ (`NODE_LOCKED`,
  `SCHEMA_VALIDATION_FAILED`, `SESSION_ALREADY_COMPLETED`, …).
- Идемпотентность мутаций практики — заголовок `Idempotency-Key`.
- `SA` = Server Action, `RH` = Route Handler.

---

## 1. Пути обучения

### `SA` `createLearningPath`

```ts
input: {
  title: string;            // 3..120
  goal: string;             // 10..2000 — формулировка цели пользователя
  targetLevel?: string;
  generateTree: boolean;    // true -> сразу поставить задачу генерации
}
output: { pathId: string; generationId?: string }
```

### `GET /api/paths/:pathId/graph`

Полный срез для React Flow. Один запрос — вся карта.

```ts
200: {
  path: { id, title, goal, status, estimatedHours };
  nodes: Array<{
    id; parentId: string | null; title; description;
    status: NodeStatus; depth; orderIndex;
    weight; difficulty; contentReady;
    position: { x: number; y: number };
    progress: {
      knowledgeStrength: number;      // 0..100
      automaticityIndex: number;      // 0..1
      timeToMasterySeconds: number | null;
    };
    review: { due: string | null; state: FsrsState } | null;
    locked: boolean;                  // не выполнены prerequisite-рёбра
  }>;
  edges: Array<{ source; target; relation: NodeRelation; strength: number }>;
  stats: { total; mastered; automated; needsReview; hasGaps };
}
```

### `SA` `arrangeNodes`

Кнопка «Упорядочить»: перезаписывает координаты всех узлов пути авто-раскладкой.

```ts
arrangeNodes({ pathId, grouping, expectedLayoutVersion, positions })
// grouping: 'bloom' | 'prerequisite' | 'status' | 'module'
```

Позиции считает клиент — там же, где живёт воркер для графов от 200 узлов.
Сервер их не пересчитывает, но проверяет принадлежность каждого узла пути,
как и при ручном перетаскивании.

`expectedLayoutVersion` — версия из `path.layoutVersion`. Не совпала —
`{ ok: false, conflict: { serverLayoutVersion } }`: чужая расстановка не
перетирается молча. Версия одна на путь, а не на узел: «Упорядочить» меняет
раскладку целиком, и конфликтует именно она.

Раскладка детерминирована: одинаковый граф → одинаковые координаты. Иначе
двойное нажатие давало бы две разные карты, а тест на это написать не на чем.
Обратимость — снимок на клиенте и один шаг «Отменить»; он живёт в памяти
вкладки и честно пропадает при перезагрузке.

### `SA` `updateNode` / `SA` `moveNodes` / `SA` `deleteNode`

```ts
updateNode: { nodeId; title?; description?; weight?; difficulty?; estimatedMinutes? }
moveNodes:  { positions: Array<{ nodeId; x; y }> }   // батч после drag на карте
deleteNode: { nodeId; cascade: boolean }
```

`moveNodes` вызывается debounce'ом 400 мс, применяется оптимистично.

### `SA` `upsertEdge` / `SA` `deleteEdge`

```ts
upsertEdge: { sourceId; targetId; relation: NodeRelation; strength?: number }
```

Перед вставкой `relation = 'prerequisite'` сервис проверяет ацикличность
рекурсивным CTE. Цикл → `409 GRAPH_CYCLE`.

---

## 2. Генерация контента (AI)

### `POST /api/ai/generate/tree`

Стриминг прогресса (SSE) — генерация дерева идёт десятки секунд.

```ts
body: { pathId: string; depth?: 2 | 3 | 4; breadth?: number; locale?: 'ru'|'en' }

stream events:
  { type: 'status',    stage: 'planning'|'expanding'|'linking'|'persisting' }
  { type: 'node',      node: { tempId, parentTempId, title, description, weight, difficulty } }
  { type: 'edge',      edge: { sourceTempId, targetTempId, relation, strength } }
  { type: 'done',      pathId, nodeCount, edgeCount, generationId }
  { type: 'error',     code, message }
```

Выход LLM валидируется Zod-схемой `treeGenerationSchema` **до** записи.
Провал → одна повторная попытка с текстом ошибки в промпте, затем
`ai_generations.status = 'schema_failed'` и событие `error`. Частично
валидные деревья не сохраняются — запись идёт одной транзакцией.

### `POST /api/ai/generate/module/start`

Запускает один шаг сборки модуля. Шагов три: `blocks_a` (блоки 1–5),
`blocks_b` (блоки 6–10), `assessments` (банк заданий). Каждый — один вызов
модели, и каждый обязан уложиться в платформенный лимит времени сам по себе:
три подряд в него не помещались.

```ts
body: { nodeId: string; regenerate?: boolean }

202: { nodeId, step: 'blocks_a' | 'blocks_b' | 'assessments', status: 'started' }
200: { nodeId, step: null, status: 'complete' }   // собирать больше нечего
409: { error: { code: 'CONTENT_EXISTS' } }        // материал есть, нужен regenerate
```

Какой шаг выполнять, решает сервер по содержимому базы, а не клиент. Поэтому
повторный запуск после обрыва доделывает недостающее, а не начинает заново;
клиенту остаётся вызывать `start` до ответа `step: null`.

### `GET /api/ai/generate/module/status?nodeId=`

```ts
200: {
  nodeId;
  contentReady: boolean;          // материал собран целиком
  doneSteps: ModuleStep[];        // что уже лежит в базе
  nextStep: ModuleStep | null;
  blockCount; assessmentCount;
  status: 'pending' | 'succeeded' | 'schema_failed' | 'provider_failed' | null;
  operation: string | null;       // вызов модели, о котором говорит status
  error: string | null;
  startedAt: string | null;
}
```

Инварианты, проверяемые сервисом перед записью:

- ровно 10 блоков, типы и порядок совпадают с каноном;
- блок 1 — `pre_assessment`, к нему привязано ≥ 3 задания
  с `is_pre_assessment = true`;
- каждая `variant_group_id` содержит 3–5 заданий с разными `context_label`;
- есть задания уровней `apply` и выше с `feedback_mode = 'delayed'`.

Нарушение → результат шага отбрасывается целиком; уже сохранённые шаги
остаются, и повторный запуск переделывает только провалившийся.

---

## 3. Практика

### `GET /api/practice/next`

Подбор набора заданий. Ядро интерливинга.

```ts
query: {
  nodeId: string;
  mix?: boolean;          // default false; true -> добавить смежные узлы
  limit?: number;         // default 10, max 30
  mode?: PracticeMode;    // default 'focused'
  interleaveRatio?: number; // 0..0.6; default из cognitive_profile
}

200: {
  sessionDraftId: string;   // фиксирует состав; передать в POST /sessions
  items: Array<{
    assessmentId; nodeId; nodeTitle;
    type: AssessmentType; cognitiveLevel;
    prompt; payload: AssessmentPayload;
    feedbackMode: 'instant' | 'delayed';
    targetResponseMs: number | null;
    /** true, если вопрос из смежного узла (UI подсвечивает смену контекста) */
    interleaved: boolean;
  }>;
  meta: { sourceNodeIds: string[]; interleaveRatio: number; citationKey: 'interleaving' | null };
}
```

Правила селектора (`lib/services/practice/selector.ts`):

1. При `mix=true` пул = узел-якорь + узлы по рёбрам `related`/`contrast`/
   `analogous`, взвешенно по `strength`; доля смеси = `interleaveRatio`.
2. Два задания из одной `variant_group_id` в один набор не попадают.
3. Задания, отвеченные верно за последние 24 часа, исключаются.
4. Порядок перемешан так, что подряд не идут два вопроса одного узла.
5. `correct_answer` в ответе **не передаётся никогда**.

### `POST /api/practice/sessions`

```ts
body: { sessionDraftId: string }
201:  { sessionId: string; itemOrder: string[]; startedAt: string }
```

### `POST /api/practice/sessions/:sessionId/responses`

```ts
body: {
  assessmentId: string;
  response: UserResponsePayload;
  responseTimeMs: number;
  confidenceLevel?: 1|2|3|4|5;   // собирается ДО показа результата
  hintsUsed?: number;
}

// feedback_mode = 'instant'
200: {
  revealed: true;
  isCorrect: boolean;
  partialScore: number;
  explanation: string | null;
  socraticHints: string[];       // при ошибке — вопросы, не ответ
  citationKey: 'testing_effect';
}

// feedback_mode = 'delayed'
200: {
  revealed: false;
  recorded: true;
  citationKey: 'delayed_feedback';
  hint: 'Результат появится после завершения набора.';
}
```

Проверка ответа — только на сервере (`grader.ts`). Клиент правильного
ответа не видит до раскрытия.

### `POST /api/practice/sessions/:sessionId/complete`

Раскрывает отложенную обратную связь и запускает пересчёт.

```ts
200: {
  score: number;                 // 0..1
  durationMs: number;
  results: Array<{
    assessmentId; isCorrect; partialScore;
    explanation: string | null;
    confidenceLevel: number | null;
    /** уверенность была высокой при неверном ответе — сигнал калибровки */
    miscalibrated: boolean;
  }>;
  nodeUpdates: Array<{
    nodeId;
    statusBefore: NodeStatus; statusAfter: NodeStatus;
    knowledgeStrength: number; automaticityIndex: number;
    nextReviewAt: string | null;
  }>;
  /** заполнено, если узел перешёл в mastered-кандидаты */
  reflectionRequired: { nodeId: string; prompts: string[] } | null;
  calibrationSummary: { meanConfidence: number; accuracy: number; gap: number } | null;
}
```

Побочные эффекты в одной транзакции: `user_responses.feedback_shown_at`,
пересчёт `node_progress`, переходы статусов, оценка FSRS-карточки узла,
обновление `user_context` для `ProgressAnalyzer`.

---

## 4. Интервальное повторение

### `GET /api/review/queue`

```ts
query: { pathId?: string; limit?: number; horizon?: 'today'|'week' }

200: {
  due: Array<{
    cardId; nodeId; nodeTitle; pathTitle;
    due: string; state: FsrsState;
    /** вероятность вспомнить сейчас, из ts-fsrs */
    retrievability: number;
    lapses: number;
    weight: number;             // важность узла -> приоритет
    estimatedMinutes: number;
  }>;
  counts: { overdue: number; today: number; upcoming7d: number };
  /** прогноз нагрузки по дням для виджета */
  forecast: Array<{ date: string; count: number }>;
}
```

Сортировка: сначала просроченные по `due`, внутри — по `weight × (1 − retrievability)`.

### `POST /api/review/cards/:cardId/grade`

```ts
body: {
  rating: 'again'|'hard'|'good'|'easy';
  sessionId?: string;
  reviewedAt?: string;          // default now(); задаётся для офлайн-догрузки
}

200: {
  card: { due: string; state: FsrsState; stability: number; difficulty: number; scheduledDays: number };
  /** что будет при каждой оценке — для подписей на кнопках */
  preview: Record<'again'|'hard'|'good'|'easy', { due: string; scheduledDays: number }>;
  nodeStatus: NodeStatus;
}
```

Оценка выводится автоматически из результатов сессии повторения
(`accuracy` + скорость → `rating`), ручной выбор доступен как переопределение.
Планирует `ts-fsrs`; каждая оценка пишет строку в `review_logs`.

### `POST /api/review/cards/:cardId/rollback`

Отменяет последнее повторение (`ts-fsrs.rollback`), удаляет последний
`review_log`. Доступно 5 минут после оценки.

---

## 5. Тьютор

### `POST /api/tutor/chat`

Стриминг через Vercel AI SDK (`streamText` → `toUIMessageStreamResponse`).

```ts
body: {
  conversationId?: string;      // отсутствует -> создать
  nodeId?: string;
  messages: UIMessage[];
}
```

Системный промпт собирается из: узла и его блоков, среза `user_context`
(`gaps`, `misconceptions` от `ProgressAnalyzer`), `memorySummary` диалога,
последних N сообщений.

Ограничения:

- Единственный способ ответить по существу — инструмент `SocraticMethod`
  (аргументы: `targetMisconception`, `question`, `scaffoldLevel: 1..3`).
- Тьютор не имеет доступа к `assessments.correct_answer`.
- Гвард `assertNoDirectAnswer` проверяет черновик ответа перед стримингом;
  срабатывание → переформулировка (максимум 1 попытка).
- После 3 циклов без прогресса разрешён `scaffoldLevel: 3` — разбор с
  пошаговым выводом. Это не отмена принципа, а защита от фрустрации;
  событие пишется в `ai_generations.operation = 'tutor_scaffold_max'`.
- Инструмент `LogGap` пишет обнаруженный пробел в `user_context.facts.gaps`.

### `GET /api/tutor/conversations?nodeId=`

Список диалогов с превью последнего сообщения.

---

## 6. Метакогниция

### `GET /api/reflections/prompts?nodeId=&type=`

`MetacognitiveCoach` формирует вопросы по фактическим данным сессии
(что именно было неверно, где расходилась уверенность).

```ts
200: {
  prompts: string[];                                      // 3..5 вопросов
  checklist: Array<{ id: string; label: string }>;
  citationKey: 'metacognition';
  context: { accuracy: number; calibrationGap: number | null; hardestAssessmentIds: string[] };
}
```

### `POST /api/reflections`

```ts
body: {
  type: ReflectionType;
  nodeId?: string; pathId?: string; sessionId?: string;
  body: string;                  // min 1 непустой символ; UI просит ≥ 200 знаков
  selfAssessment?: SelfAssessment;
}
201: {
  reflectionId: string;
  coachFeedback: string | null;
  calibrationDelta: number | null;   // perceivedMastery(0..1) − фактическая точность
  /** разблокирован ли переход узла в mastered */
  unlockedMastery: boolean;
}
```

---

## 7. Проекты

### `POST /api/projects/:projectId/submissions`

```ts
body: { artifactUrl?: string; content?: string }   // хотя бы одно поле
201:  { submissionId: string; status: 'submitted' }
```

### `POST /api/projects/submissions/:submissionId/defense`

Стриминг защиты. ИИ **задаёт вопросы по артефакту** и не предлагает
исправлений кода.

```ts
stream events:
  { type: 'question', question: string, targetsNodeId: string | null }
  { type: 'assessment', rubricScores: Record<string, number>, defenseScore: number }
  { type: 'gaps', nodeIds: string[] }       // -> статус has_gaps + внеочередное повторение
  { type: 'done', status: SubmissionStatus }
```

---

## 8. Аналитика

### `GET /api/analytics/overview?pathId=`

```ts
200: {
  mastery: { total; notStarted; inProgress; mastered; automated; hasGaps; needsReview };
  strengthDistribution: Array<{ bucket: string; count: number }>;   // 0-20, 21-40, …
  timeToMastery: { medianSeconds: number | null; byNode: Array<{ nodeId; title; seconds }> };
  retention: { rollingAccuracy7d: number; rollingAccuracy30d: number };
  calibration: { meanConfidence: number; accuracy: number; gap: number };
  interleavingEffect: { blockedAccuracy: number; interleavedAccuracy: number };
  streak: { activeDays: number; lastActiveAt: string };
}
```

`interleavingEffect` показывается с пояснением: просадка на перемешанной
практике ожидаема (`desirable_difficulties`), сравнивать нужно отложенное
удержание, а не результат сессии.

---

## 9. Рабочая тетрадь

Тетрадь целиком детерминирована: ни один из этих маршрутов не обращается к
модели. При мёртвых провайдерах она работает без изменений.

### `GET /api/notes`

Список с фильтрами и полнотекстовым поиском.

| Параметр | Тип | Смысл |
|----------|-----|-------|
| `q` | string | поиск по заголовку и тексту; разбирается в `tsquery` с префиксом (`интерл` находит `интерливинг`) |
| `type` | enum | `capture` · `summary` · `idea` · `reflection` · `question` · `quote` · `link_note` |
| `color` | enum | `neutral` · `insight` · `question` · `gap` · `source` · `contradiction` |
| `tag` | string | заметки с этим тегом |
| `nodeId`, `sessionId`, `sourceId`, `experimentId` | uuid | срез по якорю |
| `confusion` | bool | только помеченные «не понял» — реестр непонимания |
| `due` | bool | заметки, которым пора вернуться (капсулы и живые заметки) |
| `archived` | bool | архив вместо активных, по умолчанию `false` |
| `limit`, `offset` | int | страница, по умолчанию 50 / 0 |

```json
{ "items": [ { "id": "…", "type": "idea", "title": "…", "excerpt": "…",
  "colorLabel": "insight", "tags": ["память"], "nodeTitle": "…",
  "resurfaceAt": null, "isConflictCopy": false, "version": 3 } ],
  "total": 42, "limit": 50, "offset": 0 }
```

### `POST /api/notes`

Создание. `id` можно задать клиентом — тогда повтор отправки идемпотентен
(офлайн-очередь пользуется этим). Повторный `POST` с известным `id` вернёт
`200` и `deduplicated: true` вместо дубля.

Тот же обработчик — точка захвата для публичного API и PWA share target.

### `GET` · `PATCH` · `DELETE /api/notes/:noteId`

`PATCH` обязан прислать `version` — ту, от которой правил человек.

* версии совпали → `200 { id, version, updatedAt }`;
* версия отстала, но текст совпадает → `200 … deduplicated: true` (правка уже доехала);
* версия отстала и текст разошёлся → `409 VERSION_CONFLICT`.

Ответ конфликта отдаёт серверную сторону целиком — клиенту нужен не факт
расхождения, а обе версии:

```json
{ "error": { "code": "VERSION_CONFLICT", "message": "…" },
  "serverVersion": 5, "serverNote": { "...": "полная заметка с сервера" },
  "suggestedConflictTitle": "Интерливинг (конфликтная копия, 16.08 10:00)" }
```

Автоматического слияния текста нет и не будет: сведение прозы даёт
правдоподобный результат, не принадлежащий никому. Клиент сохраняет обе
копии (`conflictOfNoteId` у новой), разбирает человек.

### `GET` · `POST` · `DELETE /api/notes/:noteId/links`

Типизированные связи между заметками: `supports` · `contradicts` ·
`extends` · `question_of` · `example_of`. Владение проверяется по обеим
заметкам сразу. `GET` отдаёт связи в обе стороны — обратные ссылки половина
ценности второго слоя.

### `POST /api/notes/:noteId/pipeline`

Пайплайны «мысль → действие». `{ "kind": "to_experiment" | "to_tutor" }`.

`to_experiment` — идея становится ЧЕРНОВИКОМ N-of-1 эксперимента
(`status: draft`): запуск меняет подбор практики на неделю вперёд, и это
решение человека, а не следствие того, что он записал мысль. Гипотеза
собирается из его слов; переменная угадывается по тексту из четырёх, которыми
подбор реально управляет. Метрика всегда `delayed_accuracy` — по результату
самой сессии желательные трудности систематически проигрывали бы.

`to_tutor` — вопрос уходит в очередь сократического тьютора. Диалог создаётся
пустым, вопрос человека передаётся дословно. Ответ приходит обычным путём
(`POST /api/tutor/chat`) — через circuit breaker и с аудитом; при мёртвых
провайдерах вопрос остаётся в очереди, а заметка на месте.

Повторный вызов возвращает уже созданный объект (`existing: true`).

### `POST /api/notes/:noteId/capsule`

Капсула времени. `{ "kind": "schedule", prediction, confidence (1–5),
resurfaceAt }` назначает дату; `{ "kind": "answer", outcome, outcomeNote }`
отвечает вернувшейся капсуле.

Ответ содержит точку калибровки:

```json
{ "answered": true,
  "calibration": { "predictedConfidence": 0.75, "outcomeScore": 0.5, "gap": 0.25 } }
```

`gap > 0` — переоценка себя, как и везде в приложении. AI в оценке «сбылось
ли» не участвует: он не знает контекста человека и превратил бы данные о
калибровке в собственную догадку.

### `GET /api/notes/confusions?days=`

Реестр непонимания: пометки «не понял», сгруппированные по узлу.
`suggestsContrast: true` при трёх и более пометках на одном узле — это
похоже на смешение двух понятий, а не на пробел, и лечится контрастными
случаями.

### `GET /api/search?q=`

Общий поиск палитры ⌘K по заметкам (полнотекстовый индекс) и узлам знаний.
Детерминированный, без модели.

### `GET /api/notes/export`

Архив `.zip` с `.md`-файлами: YAML front-matter в формате Obsidian,
`[[wiki-ссылки]]` для связей, индексный файл с группировкой по узлам.
Не зависит ни от AI, ни от состояния провайдеров.

---

## 10. Умные подсказки в практике

Движок правил детерминирован: `src/lib/practice/hints/` не импортирует
`lib/ai` (проверяется тестом). Подсказки НЕ влияют на подбор заданий, длину
набора и расписание FSRS — это ограждение проверяется тем же тестом.

### Контекст подсказок в `GET /api/practice/next`

Ответ дополнен полем `hints` — всё, что нужно правилам, отдаётся один раз
при старте сессии. Правила — чистые функции, ходить за данными по ходу они
не могут; побочный эффект приятный: подсказки продолжают работать, когда
сеть отвалилась посреди сессии.

```json
{ "hints": {
  "enabled": true,
  "disabledRules": [],
  "neighbours": { "<nodeId>": ["<nodeId>"] },
  "dueNotes": [{ "noteId": "…", "title": "…", "nodeId": "…" }] } }
```

`neighbours` — соседи по «мягким» связям (`related` · `contrast` ·
`analogous`), BFS-1. `prerequisite` сюда не входит: он задаёт порядок
изучения, а не близость тем.

### `POST /api/practice/hints/events`

Журнал срабатываний — основание для будущей настройки порогов.

```json
{ "ruleId": "rest_suggestion", "outcome": "shown",
  "sessionId": "…", "nodeId": "…", "itemIndex": 8,
  "trigger": { "percent": 62 } }
```

`outcome`: `shown` · `dismissed` · `acted` · `muted`. В `trigger` уходят
только числа и идентификаторы, при которых сработало правило — тексты
заданий и ответов туда не попадают.

### `GET` · `POST /api/settings/hints`

Мастер-выключатель (`enabled`) и отключение отдельных типов
(`disableRule` / `enableRule` / `disabledRules`). «Больше не показывать
этот тип» из карточки приходит сюда же: отключение означает «навсегда», а
не «до конца сессии».

### Правила v1

| id | Срабатывает | Лимит |
|----|-------------|-------|
| `review_before_session` | до первого задания, если у узлов сессии есть заметки к перечитыванию (максимум 2) | 1 за сессию |
| `metacognitive_coaching` | уверенность ≥ 4 при неверном ответе | 2, cooldown 3 задания |
| `capture_nudge` | флаг «не понял» или провал `transfer_task` | 3, cooldown 2 |
| `contrast_mode_offer` | ≥ 2 ошибок в окне из 5 заданий по узлу или его соседям | 2, cooldown 5 |
| `rest_suggestion` | скользящая медиана времени верных ответов выросла > 40% к первым пяти, сделано ≥ 8 заданий | 1 за сессию |
| `difficulty_indicator` | уровень Блума ≥ 4 у следующего задания | 1 за сессию |

Правило отдыха читает внутрисессионную скользящую медиану, а НЕ долгосрочный
индекс усталости (`services/practice/fatigue.ts`): тот остаётся наблюдением
в аналитике до валидации на собственных данных.

---

## 11. Управление push-устройствами

### `GET /api/push/devices`

Список подписок: имя (своё или разобранное из User-Agent), хвост
`endpoint`, даты. Целиком `endpoint` наружу не отдаётся — это секрет
доставки. `pushConfigured: false` означает, что ключей VAPID нет и доставки
не будет: список честно это показывает.

### `PATCH` · `DELETE /api/push/devices/:deviceId`

Переименование и явный отзыв. Отзыв работает и тогда, когда устройства нет
под рукой: строка удаляется, рассылка ходит по строкам. Само устройство
продолжит считать себя подписанным до следующего визита — это ограничение
Push API, а не недоделка.

---

## 12. Развёрнутая аналитика и выгрузка

### `GET /api/analytics/export?dataset=&pathId=`

Режим «эксперт»: CSV с сырыми данными. `dataset`: `responses` · `nodes` ·
`sessions`.

Смысл не в удобстве, а в проверяемости. Приложение утверждает вещи о вашем
обучении — «прочность 72», «заметная переоценка себя», «интерливинг
работает». Все они выведены из этих строк, и человек должен иметь
возможность пересчитать их сам, а не верить на слово.

Тексты ответов не выгружаются: для пересчёта метрик они не нужны, а файл с
ними легко уходит туда, куда его не собирались отправлять. Формат — RFC 4180
с BOM (без BOM Excel читает UTF-8 как локальную кодировку).

### `GET /api/search?q=`

Общий поиск палитры ⌘K по заметкам и узлам знаний. Детерминированный.

---

## 13. AI-слой тетради (Фаза W8)

Весь слой за флагом `users.preferences.aiOnNotes`, выключенным по умолчанию.
Без него тетрадь функциональна полностью — это условие, а не оговорка.

### `POST /api/notes/search`

Гибридный поиск: полнотекстовый плюс векторный, слитые через RRF (Reciprocal
Rank Fusion, k = 60). RRF работает с рангами, а не с оценками: `ts_rank`
Postgres и косинусное расстояние живут в разных шкалах, и взвешенная сумма
потребовала бы нормализации, зависящей от конкретной выдачи.

```json
{ "q": "интерливинг", "embedding": [384 числа], "limit": 20 }
```

Ответ всегда сообщает, была ли семантика на самом деле:

| `degraded` | Что произошло |
|------------|---------------|
| `null` | оба слоя отработали |
| `ai_off` | человек не разрешал AI работать с заметками |
| `no_query_vector` | клиент не прислал вектор (модель ещё грузится) |
| `no_index` | векторов нет или запрос к ним не прошёл |

Во всех случаях выдача возвращается — полнотекстовая. Молча отдать её под
видом семантической значило бы заставить доверять тому, чего не было.

### `GET` · `POST /api/notes/embeddings`

`GET` отдаёт заметки без актуального вектора, `POST` принимает готовые.
Считает векторы клиент — локальной моделью `Xenova/all-MiniLM-L6-v2` (384
измерения) в воркере, тем же способом, каким в проекте уже расшифровывается
аудио. Текст заметок не уезжает наружу ради поиска, и слой работает при
нулевом лимите провайдеров.

Размерность 384, а не 1536 из эскиза плана: её задаёт локальная модель.
Векторы разных моделей несопоставимы, поэтому `model` проверяется на входе.

При выключенном `aiOnNotes` оба маршрута отвечают `503 DISABLED`: молча
принимать векторы при выключенной настройке значило бы обходить решение
человека.

### `GET /api/notes/weekly`

Итог недели, ответ двухслойный:

* `stats` и `contradictions` — детерминированные, приходят **всегда**;
* `narrative` — черновик от модели, может быть `null`.

`narrativeUnavailable`: `ai_off` · `no_data` · `provider_down`. Числа важнее
текста о числах, поэтому отказ модели не отменяет итог недели.

Противоречия отбираются правилами, а не моделью: модель, которой отдали
сырые заметки и попросили найти противоречия, найдёт их всегда — это её
работа, а не свойство данных. Правило требует измеримого расхождения:
уверенное утверждение в заметке при точности по узлу ниже 60% на восьми и
более ответах. Пометка «не понял» снимает кандидата — это согласие с
практикой, а не спор.

---

## 14. Календарь и уведомления

### `GET /api/calendar/:token.ics`

Лента повторений в формате iCalendar. Единственный маршрут без сессии — и это
вынужденно: календарные клиенты не логинятся, они ходят по ссылке фоновым
процессом. Защита подписью:

```
token = userId.HMAC-SHA256(userId, AUTH_SECRET)[:32]
```

Подпись, а не случайная строка в базе: токен не нужно хранить, отзыв делается
сменой секрета — разом для всех выданных ссылок. Ссылка при этом остаётся
секретом, и в интерфейсе она подписана именно так.

Наружу отдаются только названия узлов и сроки. Ни ответов, ни заметок, ни
прочности: календарь у многих синхронизируется в места, о которых человек не
думает, отдавая ссылку. Без `AUTH_SECRET` маршрут отвечает `503 DISABLED` —
подписать нечем, а отдавать без подписи нельзя.

Синхронизация через Google/Outlook API (Фаза 2) требует OAuth-клиента — это
решение владельца, в код не взято.

### Категории уведомлений и бюджет тишины

| Категория | Когда | Лимит в неделю |
|-----------|-------|----------------|
| `review_due` | есть просроченные повторения | 7 |
| `node_weak` | прочность узла ≤ 40 при ≥ 5 повторениях | 2 |
| `experiment_ready` | окно N-of-1 эксперимента прошло | 2 |
| `note_capsule` | вернулась капсула времени | 7 |

Бюджет — не вежливость, а сохранение сигнала: уведомление работает, пока его
читают, и приложение, пишущее каждый день, обучает смахивать себя не глядя.

За прогон уходит не больше одного уведомления на категорию. При нехватке
бюджета приоритет у того, что человек назначил себе сам (капсула), а не у
рутинного напоминания. Бюджет тратит только доставленное — списывать
недоставленное значит наказывать за чужой сбой. Счётчик виден в `/settings`:
ограничение, о котором нельзя узнать, ничем не отличается от его отсутствия.

---

## 15. Коды ошибок

| Код | HTTP | Когда |
|-----|------|-------|
| `UNAUTHORIZED` | 401 | нет сессии |
| `FORBIDDEN` | 403 | ресурс чужого пользователя |
| `NODE_LOCKED` | 409 | не выполнены prerequisite-зависимости |
| `LAYOUT_CONFLICT` | — | раскладку карты изменили в другом месте (в `ActionResult.conflict`) |
| `GRAPH_CYCLE` | 409 | ребро создаёт цикл |
| `SESSION_ALREADY_COMPLETED` | 409 | повторный `complete` |
| `ANSWER_ALREADY_SUBMITTED` | 409 | повторный ответ на задание в сессии |
| `PRE_ASSESSMENT_REQUIRED` | 409 | попытка открыть теорию до pre-теста |
| `REFLECTION_REQUIRED` | 409 | переход в `mastered` без рефлексии |
| `SCHEMA_VALIDATION_FAILED` | 422 | выход LLM не прошёл Zod |
| `CONTENT_NOT_READY` | 409 | у узла нет 10 блоков |
| `RATE_LIMITED` | 429 | лимит вызовов LLM |
| `VERSION_CONFLICT` | 409 | правка от устаревшей версии (заметки, раскладка карты) |
| `DISABLED` | 503 | функция выключена честно (нет ключей, нет провайдеров) |
| `VALIDATION_FAILED` | 400 | тело запроса не прошло Zod |
| `NOT_FOUND` | 404 | объекта нет или он принадлежит другому пользователю |
