import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Контракт опроса: клиент должен по одному ответу понять и что уже сделано,
 * и почему следующий шаг не сдвинулся. Поэтому в ответе сведены два разных
 * источника — содержимое узла и итог последнего вызова модели.
 */

const NODE_ID = '33333333-3333-4333-8333-333333333333';

vi.mock('@/lib/auth/require-user', () => ({
  requireUserIdOrThrow: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

class ContentGenerationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const moduleProgressMock = vi.fn();
vi.mock('@/lib/ai/agents/content-generator', () => ({
  ContentGenerationError,
  moduleProgress: (...args: unknown[]) => moduleProgressMock(...args),
}));

const moduleGenerationStatusMock = vi.fn();
vi.mock('@/lib/ai/status', () => ({
  moduleGenerationStatus: (...args: unknown[]) => moduleGenerationStatusMock(...args),
}));

const { GET } = await import('./route');

function request(nodeId: string): Request {
  return new Request(`http://localhost/api/ai/generate/module/status?nodeId=${nodeId}`);
}

describe('GET /api/ai/generate/module/status', () => {
  beforeEach(() => {
    moduleProgressMock.mockReset();
    moduleGenerationStatusMock.mockReset();
  });

  it('сводит сделанные шаги и причину остановки в один ответ', async () => {
    moduleGenerationStatusMock.mockResolvedValueOnce({
      nodeId: NODE_ID,
      contentReady: false,
      status: 'provider_failed',
      operation: 'generate_module_assessments',
      error: 'Rate limit exceeded',
      startedAt: '2026-08-18T10:00:00.000Z',
    });
    moduleProgressMock.mockResolvedValueOnce({
      contentReady: false,
      doneSteps: ['blocks_a', 'blocks_b'],
      nextStep: 'assessments',
      blockCount: 10,
      assessmentCount: 0,
    });

    const response = await GET(request(NODE_ID));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      doneSteps: ['blocks_a', 'blocks_b'],
      nextStep: 'assessments',
      blockCount: 10,
      status: 'provider_failed',
      error: 'Rate limit exceeded',
    });
  });

  it('чужой узел — 404, состояние не раскрывается', async () => {
    moduleGenerationStatusMock.mockRejectedValueOnce(
      new ContentGenerationError('Узел не найден', 'NOT_FOUND'),
    );

    const response = await GET(request(NODE_ID));

    expect(response.status).toBe(404);
    expect(moduleProgressMock).not.toHaveBeenCalled();
  });

  it('без корректного nodeId — 400', async () => {
    const response = await GET(request('не-uuid'));

    expect(response.status).toBe(400);
    expect(moduleGenerationStatusMock).not.toHaveBeenCalled();
  });
});
