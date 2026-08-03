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

### `POST /api/ai/generate/module`

Генерирует все 10 блоков узла + банк заданий.

```ts
body: { nodeId: string; regenerate?: boolean }

stream events:
  { type: 'block',       block: { type: ContentBlockType, title, orderIndex, payload } }
  { type: 'assessment',  assessment: { type, cognitiveLevel, prompt, payload, feedbackMode, variantGroupId, contextLabel } }
  { type: 'done',        nodeId, blockCount: 10, assessmentCount }
```

Инварианты, проверяемые сервисом перед коммитом:

- ровно 10 блоков, типы и порядок совпадают с каноном;
- блок 1 — `pre_assessment`, к нему привязано ≥ 3 задания
  с `is_pre_assessment = true`;
- каждая `variant_group_id` содержит 3–5 заданий с разными `context_label`;
- есть задания уровней `apply` и выше с `feedback_mode = 'delayed'`.

Нарушение → генерация отбрасывается целиком.

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

## 9. Коды ошибок

| Код | HTTP | Когда |
|-----|------|-------|
| `UNAUTHORIZED` | 401 | нет сессии |
| `FORBIDDEN` | 403 | ресурс чужого пользователя |
| `NODE_LOCKED` | 409 | не выполнены prerequisite-зависимости |
| `GRAPH_CYCLE` | 409 | ребро создаёт цикл |
| `SESSION_ALREADY_COMPLETED` | 409 | повторный `complete` |
| `ANSWER_ALREADY_SUBMITTED` | 409 | повторный ответ на задание в сессии |
| `PRE_ASSESSMENT_REQUIRED` | 409 | попытка открыть теорию до pre-теста |
| `REFLECTION_REQUIRED` | 409 | переход в `mastered` без рефлексии |
| `SCHEMA_VALIDATION_FAILED` | 422 | выход LLM не прошёл Zod |
| `CONTENT_NOT_READY` | 409 | у узла нет 10 блоков |
| `RATE_LIMITED` | 429 | лимит вызовов LLM |
