import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Полностью офлайн: `db` и LLM-агент замоканы, тест проверяет КОНТРАКТ
 * эндпоинта (сохранение рефлексии переживает таймаут/провал LLM), а не
 * поведение реальной сети — сеть до Neon у этого проекта нестабильна
 * (см. память "NeuroLearn network flakiness"), гонять живую БД в юнит-тесте
 * означало бы флейки не про код, а про инфраструктуру.
 */

vi.mock('@/lib/auth/require-user', () => ({
  requireUserIdOrThrow: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const scoreReflectionMock = vi.fn();
vi.mock('@/lib/ai/agents/metacognitive-coach', () => ({
  scoreReflection: (...args: unknown[]) => scoreReflectionMock(...args),
}));

const recomputeNodeProgressMock = vi.fn();
vi.mock('@/lib/db/queries/progress', () => ({
  recomputeNodeProgress: (...args: unknown[]) => recomputeNodeProgressMock(...args),
}));

/** Мини-реализация чейнящегося query builder'а Drizzle: каждый метод
 * возвращает себя же, а `await` на конце резолвится в заранее заданный результат. */
function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'innerJoin', 'values', 'returning', 'orderBy', 'limit']) {
    obj[method] = vi.fn(() => obj);
  }
  (obj as { then: PromiseLike<unknown>['then'] }).then = (resolve, reject) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const findFirstMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => chain([{ id: 'owned-row' }])),
    insert: vi.fn(() => chain([{ id: 'reflection-1' }])),
    query: {
      reflections: {
        findFirst: (...args: unknown[]) => findFirstMock(...args),
      },
    },
  },
}));

// z.uuid() в Zod v4 проверяет версию/вариант — «22222222-2222-2222-…» не проходит,
// нужен формат настоящего UUIDv4 (3-я группа '4xxx', 4-я '8/9/a/b xxx').
const PATH_ID = '22222222-2222-4222-8222-222222222222';

function request(body: unknown): Request {
  return new Request('http://localhost/api/reflections', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/reflections', () => {
  beforeEach(() => {
    scoreReflectionMock.mockReset();
    findFirstMock.mockReset();
    recomputeNodeProgressMock.mockReset();
  });

  it('сохраняет рефлексию, даже если оценка коуча падает по таймауту', async () => {
    const { POST } = await import('./route');

    scoreReflectionMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 20_000)), // дольше SCORE_TIMEOUT_MS (8с)
    );
    findFirstMock.mockResolvedValue({
      id: 'reflection-1',
      coachFeedback: null,
      calibrationDelta: null,
    });

    const res = await POST(
      request({
        type: 'post_module',
        pathId: PATH_ID,
        body: 'Разобрался с приоритизацией по RICE, сложнее всего дались веса Confidence.',
      }),
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.reflectionId).toBe('reflection-1');
    // Деградация, не провал запроса: текст рефлексии уже сохранён строкой
    // INSERT ДО попытки оценки коучем — таймаут не должен откатывать запись.
    expect(json.coachFeedback).toBeNull();
  }, 10_000);

  it('возвращает coachFeedback, когда LLM успевает ответить', async () => {
    const { POST } = await import('./route');

    scoreReflectionMock.mockResolvedValue(undefined); // scoreReflection пишет в БД сам
    findFirstMock.mockResolvedValue({
      id: 'reflection-1',
      coachFeedback: 'Хорошо разобран источник ошибки в весах RICE.',
      calibrationDelta: 0.1,
    });

    const res = await POST(request({ type: 'post_module', pathId: PATH_ID, body: 'X'.repeat(200) }));

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.coachFeedback).toBe('Хорошо разобран источник ошибки в весах RICE.');
  });

  it('400 без nodeId и pathId — схема требует хотя бы один', async () => {
    const { POST } = await import('./route');

    const res = await POST(request({ type: 'post_module', body: 'X'.repeat(200) }));
    expect(res.status).toBe(400);
  });
});
