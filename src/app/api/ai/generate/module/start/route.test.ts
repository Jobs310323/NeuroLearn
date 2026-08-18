import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Контракт запуска шага. Проверяется то, ради чего шаги и разделялись:
 * какой шаг выполнять, решает сервер по состоянию узла, а клиент только
 * повторяет запрос, пока сервер не ответит «делать больше нечего».
 *
 * Всё офлайн: сеть до Neon у проекта нестабильна, и живая БД дала бы флейки
 * не про код, а про инфраструктуру.
 */

const NODE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '11111111-1111-1111-1111-111111111111';

vi.mock('@/lib/auth/require-user', () => ({
  requireUserIdOrThrow: vi.fn().mockResolvedValue(USER_ID),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock('@/lib/ai/reconcile', () => ({ reconcileStaleGenerations: vi.fn().mockResolvedValue(0) }));
vi.mock('@/lib/monitoring/logger', () => ({ logError: vi.fn() }));

const checkRateLimitMock = vi.fn().mockResolvedValue({ allowed: true });
vi.mock('@/lib/security/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

const assertModuleGeneratableMock = vi.fn().mockResolvedValue(undefined);
const moduleProgressMock = vi.fn();
const generateModuleStepMock = vi.fn().mockResolvedValue({ step: 'blocks_a', nextStep: 'blocks_b' });

class ContentGenerationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

vi.mock('@/lib/ai/agents/content-generator', () => ({
  ContentGenerationError,
  assertModuleGeneratable: (...args: unknown[]) => assertModuleGeneratableMock(...args),
  moduleProgress: (...args: unknown[]) => moduleProgressMock(...args),
  generateModuleStep: (...args: unknown[]) => generateModuleStepMock(...args),
}));

/** `after()` вне запроса Next не работает — собираем задачи и запускаем сами. */
const background: (() => Promise<unknown>)[] = [];
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    background.push(task);
  },
}));

const { POST } = await import('./route');

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/generate/module/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/generate/module/start', () => {
  beforeEach(() => {
    background.length = 0;
    generateModuleStepMock.mockClear();
    assertModuleGeneratableMock.mockClear().mockResolvedValue(undefined);
    checkRateLimitMock.mockClear().mockResolvedValue({ allowed: true });
  });

  it('называет шаг, который сервер решил выполнить, и не ждёт его конца', async () => {
    moduleProgressMock.mockResolvedValueOnce({ nextStep: 'blocks_b', doneSteps: ['blocks_a'] });

    const response = await POST(request({ nodeId: NODE_ID }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ step: 'blocks_b', status: 'started' });
    // Работа поставлена в фон, а не выполнена внутри ответа.
    expect(generateModuleStepMock).not.toHaveBeenCalled();
    expect(background).toHaveLength(1);

    await background[0]!();
    expect(generateModuleStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: NODE_ID, userId: USER_ID }),
    );
  });

  it('на собранном модуле отвечает «делать нечего» и ничего не запускает', async () => {
    moduleProgressMock.mockResolvedValueOnce({ nextStep: null, doneSteps: ['blocks_a', 'blocks_b', 'assessments'] });

    const response = await POST(request({ nodeId: NODE_ID }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ step: null, status: 'complete' });
    expect(background).toHaveLength(0);
  });

  it('материал уже есть — 409 до фоновой работы', async () => {
    assertModuleGeneratableMock.mockRejectedValueOnce(
      new ContentGenerationError('Материал уже сгенерирован', 'CONTENT_EXISTS'),
    );

    const response = await POST(request({ nodeId: NODE_ID }));

    expect(response.status).toBe(409);
    expect(background).toHaveLength(0);
  });

  it('чужой узел — 404, и это выясняется до ответа', async () => {
    assertModuleGeneratableMock.mockRejectedValueOnce(
      new ContentGenerationError('Узел не найден', 'NOT_FOUND'),
    );

    const response = await POST(request({ nodeId: NODE_ID }));

    expect(response.status).toBe(404);
    expect(background).toHaveLength(0);
  });

  it('превышение лимита — 429 с Retry-After', async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 42 });

    const response = await POST(request({ nodeId: NODE_ID }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(background).toHaveLength(0);
  });

  it('запрос без корректного nodeId отвергается', async () => {
    const response = await POST(request({ nodeId: 'не-uuid' }));

    expect(response.status).toBe(400);
    expect(background).toHaveLength(0);
  });
});
