import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Контракт завершения сессии, и в первую очередь — его повторяемость.
 *
 * Завершение делает несколько записей подряд (раскрытие обратной связи,
 * оценка FSRS по каждому узлу, пересчёт прогресса, закрытие сессии), а
 * интерактивной транзакции у neon-http нет. Значит, обработчик обязан
 * переживать обрыв на середине: повторный запрос должен доделать
 * недоделанное и не применить повторно то, что уже применено.
 *
 * Всё офлайн: `db` и планировщик FSRS замоканы — сеть до Neon у проекта
 * нестабильна, живая база дала бы флейки не про код.
 */

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const NODE_A = '33333333-3333-4333-8333-333333333333';
const NODE_B = '44444444-4444-4444-8444-444444444444';
const PATH_ID = '55555555-5555-4555-8555-555555555555';

vi.mock('@/lib/auth/require-user', () => ({
  requireUserIdOrThrow: vi.fn().mockResolvedValue(USER_ID),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const applyReviewMock = vi.fn().mockResolvedValue({ card: { id: 'card' }, logId: 'log' });
const ensureCardMock = vi.fn(async (_userId: string, nodeId: string) => ({ id: `card-${nodeId}` }));
vi.mock('@/lib/services/fsrs/engine', () => ({
  applyReview: (...args: unknown[]) => applyReviewMock(...args),
  ensureCard: (...args: [string, string]) => ensureCardMock(...args),
  deriveRatingFromSession: () => 'good',
}));

const recomputeNodeProgressMock = vi.fn(async (_userId: string, nodeId: string) => ({
  nodeId,
  statusBefore: 'in_progress',
  statusAfter: 'in_progress',
  knowledgeStrength: 40,
  automaticityIndex: 0.2,
  nextReviewAt: '2026-09-01T00:00:00.000Z',
}));
vi.mock('@/lib/db/queries/progress', () => ({
  recomputeNodeProgress: (...args: [string, string]) => recomputeNodeProgressMock(...args),
}));

const recomputeCognitiveProfileMock = vi.fn().mockResolvedValue({});
vi.mock('@/lib/db/queries/learner', () => ({
  recomputeCognitiveProfile: (...args: unknown[]) => recomputeCognitiveProfileMock(...args),
}));

const classifySessionErrorsMock = vi.fn().mockResolvedValue({ skipped: true });
vi.mock('@/lib/ai/agents/error-classifier', () => ({
  classifySessionErrors: (...args: unknown[]) => classifySessionErrorsMock(...args),
}));

const analyzeProgressMock = vi.fn().mockResolvedValue({ skipped: true });
vi.mock('@/lib/ai/agents/progress-analyzer', () => ({
  analyzeProgress: (...args: unknown[]) => analyzeProgressMock(...args),
}));

const logErrorMock = vi.fn();
vi.mock('@/lib/monitoring/logger', () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

/** `after()` вне запроса Next не работает — собираем задачи и запускаем сами. */
const background: (() => Promise<unknown>)[] = [];
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    background.push(task);
  },
}));

/** Чейнящийся query builder Drizzle: методы возвращают себя, `await` — результат. */
function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'innerJoin', 'set', 'values', 'returning', 'orderBy', 'limit']) {
    obj[method] = vi.fn(() => obj);
  }
  (obj as { then: PromiseLike<unknown>['then'] }).then = (resolve, reject) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

/**
 * `select()` в обработчике вызывается дважды и за разным: сначала ответы
 * сессии, потом узлы, по которым оценка уже записана. Мок отдаёт заранее
 * разложенную очередь — так тест управляет именно вторым запросом.
 */
const selectResults: unknown[] = [];
const sessionRow = vi.fn();
const updateCalls: unknown[] = [];

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => chain(selectResults.shift() ?? [])),
    update: vi.fn(() => {
      const c = chain([]);
      updateCalls.push(c);
      return c;
    }),
    batch: vi.fn(async () => []),
    query: {
      practiceSessions: { findFirst: (...args: unknown[]) => sessionRow(...args) },
      assessments: { findMany: vi.fn(async () => []) },
    },
  },
}));

const { POST } = await import('./route');

function request() {
  return [
    new Request(`http://localhost/api/practice/sessions/${SESSION_ID}/complete`, { method: 'POST' }),
    { params: Promise.resolve({ sessionId: SESSION_ID }) },
  ] as const;
}

function response(nodeId: string, id: string) {
  return {
    id,
    nodeId,
    assessmentId: `a-${id}`,
    isCorrect: true,
    partialScore: 1,
    responseTimeMs: 3000,
    confidenceLevel: 4,
    feedbackShownAt: new Date(),
  };
}

describe('POST /api/practice/sessions/:id/complete', () => {
  beforeEach(() => {
    selectResults.length = 0;
    updateCalls.length = 0;
    background.length = 0;
    applyReviewMock.mockClear();
    ensureCardMock.mockClear();
    recomputeNodeProgressMock.mockClear();
    recomputeCognitiveProfileMock.mockClear().mockResolvedValue({});
    classifySessionErrorsMock.mockClear().mockResolvedValue({ skipped: true });
    analyzeProgressMock.mockClear().mockResolvedValue({ skipped: true });
    logErrorMock.mockClear();
    sessionRow.mockReset().mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      pathId: PATH_ID,
      completedAt: null,
      startedAt: new Date(Date.now() - 60_000),
    });
  });

  it('оценивает каждый затронутый узел ровно один раз', async () => {
    selectResults.push([response(NODE_A, 'r1'), response(NODE_A, 'r2'), response(NODE_B, 'r3')]);
    selectResults.push([]); // повторений по этой сессии ещё нет

    const res = await POST(...request());

    expect(res.status).toBe(200);
    expect(applyReviewMock).toHaveBeenCalledTimes(2);
    const graded = applyReviewMock.mock.calls.map((call) => (call[0] as { card: { id: string } }).card.id);
    expect(new Set(graded)).toEqual(new Set([`card-${NODE_A}`, `card-${NODE_B}`]));
  });

  it('после обрыва доделывает только неоценённые узлы', async () => {
    selectResults.push([response(NODE_A, 'r1'), response(NODE_B, 'r2')]);
    // Узел A уже получил оценку в этой сессии до обрыва.
    selectResults.push([{ nodeId: NODE_A }]);

    const res = await POST(...request());

    expect(res.status).toBe(200);
    expect(applyReviewMock).toHaveBeenCalledTimes(1);
    expect(ensureCardMock).toHaveBeenCalledWith(USER_ID, NODE_B);
    // Пересчёт прогресса идемпотентен и идёт по обоим узлам.
    expect(recomputeNodeProgressMock).toHaveBeenCalledTimes(2);
  });

  it('сессия закрывается последней — после оценки всех узлов', async () => {
    selectResults.push([response(NODE_A, 'r1')]);
    selectResults.push([]);
    const order: string[] = [];
    applyReviewMock.mockImplementationOnce(async () => {
      order.push('review');
      return { card: { id: 'card' }, logId: 'log' };
    });

    await POST(...request());
    order.push('close');

    // Закрытие сессии — единственный `update` практики в обработчике, и он
    // выполняется после цикла оценок: иначе повторный запрос упёрся бы в 409
    // и недооценённые узлы остались бы без повторения навсегда.
    expect(order).toEqual(['review', 'close']);
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it('модель ученика обновляется в фоне, а не внутри ответа', async () => {
    selectResults.push([response(NODE_A, 'r1')]);
    selectResults.push([]);

    const res = await POST(...request());

    expect(res.status).toBe(200);
    // Отчёт о сессии не должен ждать ни арифметики портрета, ни вызова модели.
    expect(recomputeCognitiveProfileMock).not.toHaveBeenCalled();
    expect(analyzeProgressMock).not.toHaveBeenCalled();
    expect(background).toHaveLength(1);

    await background[0]!();
    expect(recomputeCognitiveProfileMock).toHaveBeenCalledWith(USER_ID);
    expect(classifySessionErrorsMock).toHaveBeenCalledWith({ userId: USER_ID, sessionId: SESSION_ID });
    expect(analyzeProgressMock).toHaveBeenCalledWith({
      userId: USER_ID,
      scope: { scope: 'path', pathId: PATH_ID },
    });
  });

  it('провал разбора не роняет фоновую задачу и не отменяет портрет', async () => {
    selectResults.push([response(NODE_A, 'r1')]);
    selectResults.push([]);
    analyzeProgressMock.mockRejectedValueOnce(new Error('провайдер недоступен'));

    await POST(...request());
    // Ошибка внутри `after()` не имеет кому всплыть: запрос уже отвечен.
    // Значит, она обязана быть поймана и залогирована здесь.
    await expect(background[0]!()).resolves.toBeUndefined();

    expect(recomputeCognitiveProfileMock).toHaveBeenCalledWith(USER_ID);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      'session-complete:analyze-progress',
      expect.objectContaining({ sessionId: SESSION_ID }),
    );
  });

  it('сессия без пути — портрет считается, разбор не запускается', async () => {
    sessionRow.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      pathId: null,
      completedAt: null,
      startedAt: new Date(Date.now() - 60_000),
    });
    selectResults.push([response(NODE_A, 'r1')]);
    selectResults.push([]);

    await POST(...request());
    await background[0]!();

    expect(recomputeCognitiveProfileMock).toHaveBeenCalledWith(USER_ID);
    // Область разбора — путь; без него звать нечего.
    expect(analyzeProgressMock).not.toHaveBeenCalled();
  });

  it('уже завершённая сессия — 409, побочных эффектов нет', async () => {
    sessionRow.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      pathId: PATH_ID,
      completedAt: new Date(),
      startedAt: new Date(),
    });

    const res = await POST(...request());

    expect(res.status).toBe(409);
    expect(applyReviewMock).not.toHaveBeenCalled();
  });

  it('чужая сессия — 404', async () => {
    sessionRow.mockResolvedValue(undefined);

    const res = await POST(...request());

    expect(res.status).toBe(404);
    expect(applyReviewMock).not.toHaveBeenCalled();
  });
});
