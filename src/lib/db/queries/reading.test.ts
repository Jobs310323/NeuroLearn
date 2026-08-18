import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Тот же мини-чейнящийся мок Drizzle, что и в других query-тестах проекта. */
function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'innerJoin', 'orderBy', 'limit']) {
    obj[method] = vi.fn(() => obj);
  }
  (obj as { then: PromiseLike<unknown>['then'] }).then = (resolve, reject) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const selectMock = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { select: (...args: unknown[]) => selectMock(...args) },
}));

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const NODE_ID = '33333333-3333-4333-8333-333333333333';

function nodeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return [
    {
      nodeId: NODE_ID,
      title: 'Составлять PRD',
      description: 'Документ требований к продукту',
      contentReady: true,
      pathId: 'path-1',
      pathTitle: 'Продакт-менеджмент',
      ownerId: USER_ID,
      ...overrides,
    },
  ];
}

describe('getNodeReadingMaterial', () => {
  beforeEach(() => {
    selectMock.mockReset();
  });

  it('возвращает null, если узел принадлежит другому пользователю', async () => {
    selectMock.mockReturnValueOnce(chain(nodeRow({ ownerId: OTHER_USER_ID })));
    const { getNodeReadingMaterial } = await import('./reading');

    const result = await getNodeReadingMaterial(USER_ID, NODE_ID);
    expect(result).toBeNull();
  });

  it('возвращает null, если материал ещё не сгенерирован', async () => {
    selectMock.mockReturnValueOnce(chain(nodeRow({ contentReady: false })));
    const { getNodeReadingMaterial } = await import('./reading');

    const result = await getNodeReadingMaterial(USER_ID, NODE_ID);
    expect(result).toBeNull();
  });

  it('возвращает null, если узел не найден', async () => {
    selectMock.mockReturnValueOnce(chain([]));
    const { getNodeReadingMaterial } = await import('./reading');

    const result = await getNodeReadingMaterial(USER_ID, NODE_ID);
    expect(result).toBeNull();
  });

  it('отдаёт блоки в порядке order_index у своего готового узла', async () => {
    const blocks = [
      { id: 'b1', type: 'pre_assessment', title: 'Проверка', orderIndex: 0, payload: { kind: 'prose', markdown: 'x' }, scienceCitationKey: 'pretesting' },
      { id: 'b2', type: 'concept', title: 'Теория', orderIndex: 1, payload: { kind: 'prose', markdown: 'y' }, scienceCitationKey: 'worked_examples' },
    ];
    selectMock
      .mockReturnValueOnce(chain(nodeRow()))
      .mockReturnValueOnce(chain(blocks));
    const { getNodeReadingMaterial } = await import('./reading');

    const result = await getNodeReadingMaterial(USER_ID, NODE_ID);
    expect(result?.node.title).toBe('Составлять PRD');
    expect(result?.blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
  });
});
