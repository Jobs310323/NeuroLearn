import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyNoteSyncResponse, flushPendingNotes } from './note-sync';
import type { PendingNoteOp } from './note-queue';

/**
 * Инвариант, который здесь проверяется целиком: текст пользователя не
 * теряется ни при каком ответе сервера. Расхождение версий даёт вторую
 * заметку, временный отказ — остановку очереди с сохранением порядка,
 * безнадёжный ответ — снятие операции без потери уже написанного.
 */

vi.mock('./note-queue', () => ({
  listNoteOps: vi.fn(),
  removeNoteOp: vi.fn(),
  removeDraft: vi.fn(),
  saveDraft: vi.fn(),
}));

const queue = await import('./note-queue');
const listNoteOps = vi.mocked(queue.listNoteOps);
const removeNoteOp = vi.mocked(queue.removeNoteOp);
const saveDraft = vi.mocked(queue.saveDraft);

function update(id: string, queuedAt: string): PendingNoteOp {
  return {
    kind: 'update',
    id,
    noteId: `note-${id}`,
    queuedAt,
    baseVersion: 2,
    body: { contentMd: 'моя правка', title: 'Заметка', type: 'idea' },
  };
}

function create(id: string, queuedAt: string): PendingNoteOp {
  return {
    kind: 'create',
    id,
    noteId: `note-${id}`,
    queuedAt,
    body: { contentMd: 'новая заметка', type: 'capture' },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('classifyNoteSyncResponse', () => {
  it('2xx — принято', () => {
    expect(classifyNoteSyncResponse(200, {}).kind).toBe('done');
    expect(classifyNoteSyncResponse(201, {}).kind).toBe('done');
  });

  it('409 с VERSION_CONFLICT — конфликт с серверной версией', () => {
    expect(
      classifyNoteSyncResponse(409, {
        error: { code: 'VERSION_CONFLICT' },
        serverVersion: 7,
        suggestedConflictTitle: 'Заметка (конфликтная копия, 01.01 10:00)',
      }),
    ).toEqual({
      kind: 'conflict',
      serverVersion: 7,
      suggestedTitle: 'Заметка (конфликтная копия, 01.01 10:00)',
    });
  });

  it('истёкшая сессия — повтор, а не потеря заметки', () => {
    expect(classifyNoteSyncResponse(401, {}).kind).toBe('retry');
    expect(classifyNoteSyncResponse(429, {}).kind).toBe('retry');
    expect(classifyNoteSyncResponse(503, {}).kind).toBe('retry');
  });

  it('удалённая заметка и невалидное тело — снимаем, чтобы не блокировать очередь', () => {
    expect(classifyNoteSyncResponse(404, {}).kind).toBe('drop');
    expect(classifyNoteSyncResponse(400, {}).kind).toBe('drop');
  });
});

describe('flushPendingNotes', () => {
  it('отправляет операции в порядке постановки', async () => {
    listNoteOps.mockResolvedValue([
      create('1', '2026-08-16T10:00:00.000Z'),
      update('2', '2026-08-16T10:05:00.000Z'),
    ]);
    const calls: string[] = [];
    const doFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      return json(200, {});
    });

    const result = await flushPendingNotes(doFetch as unknown as typeof fetch);

    expect(calls).toEqual(['POST /api/notes', 'PATCH /api/notes/note-2']);
    expect(result.synced).toBe(2);
    expect(removeNoteOp).toHaveBeenCalledTimes(2);
  });

  it('создание уходит с клиентским id — повтор не создаёт дубль', async () => {
    listNoteOps.mockResolvedValue([create('1', '2026-08-16T10:00:00.000Z')]);
    const doFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).id).toBe('note-1');
      return json(201, {});
    });

    await flushPendingNotes(doFetch as unknown as typeof fetch);
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it('конфликт версий создаёт вторую заметку, а не перезаписывает чужую', async () => {
    listNoteOps.mockResolvedValue([update('1', '2026-08-16T10:00:00.000Z')]);

    const bodies: Record<string, unknown>[] = [];
    const doFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      bodies.push({ url: String(url), method: init?.method, body });
      if (String(url) === '/api/notes/note-1') {
        return json(409, {
          error: { code: 'VERSION_CONFLICT' },
          serverVersion: 5,
          suggestedConflictTitle: 'Заметка (конфликтная копия, 16.08 10:00)',
        });
      }
      return json(201, {});
    });

    const result = await flushPendingNotes(doFetch as unknown as typeof fetch);

    expect(result.conflicts).toBe(1);
    const copy = bodies[1] as { url: string; method: string; body: Record<string, unknown> };
    expect(copy.url).toBe('/api/notes');
    expect(copy.method).toBe('POST');
    expect(copy.body.conflictOfNoteId).toBe('note-1');
    expect(copy.body.contentMd).toBe('моя правка');
    expect(copy.body.title).toBe('Заметка (конфликтная копия, 16.08 10:00)');
  });

  it('если копию не удалось отправить — она остаётся локальным черновиком', async () => {
    listNoteOps.mockResolvedValue([update('1', '2026-08-16T10:00:00.000Z')]);
    const doFetch = vi.fn(async (url: RequestInfo | URL) =>
      String(url) === '/api/notes/note-1'
        ? json(409, { error: { code: 'VERSION_CONFLICT' }, serverVersion: 5 })
        : json(500, {}),
    );

    await flushPendingNotes(doFetch as unknown as typeof fetch);

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(saveDraft.mock.calls[0]?.[0]).toMatchObject({
      contentMd: 'моя правка',
      pending: true,
    });
  });

  it('сетевой обрыв останавливает очередь, не трогая оставшееся', async () => {
    listNoteOps.mockResolvedValue([
      create('1', '2026-08-16T10:00:00.000Z'),
      update('2', '2026-08-16T10:05:00.000Z'),
      update('3', '2026-08-16T10:10:00.000Z'),
    ]);
    const doFetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === '/api/notes') return json(201, {});
      throw new TypeError('network');
    });

    const result = await flushPendingNotes(doFetch as unknown as typeof fetch);

    expect(result.synced).toBe(1);
    expect(result.pending).toBe(2);
    expect(removeNoteOp).toHaveBeenCalledTimes(1);
  });

  it('истёкшая сессия не выбрасывает ни одной заметки', async () => {
    listNoteOps.mockResolvedValue([update('1', '2026-08-16T10:00:00.000Z')]);
    const doFetch = vi.fn(async () => json(401, {}));

    const result = await flushPendingNotes(doFetch as unknown as typeof fetch);

    expect(result).toMatchObject({ synced: 0, pending: 1, dropped: 0 });
    expect(removeNoteOp).not.toHaveBeenCalled();
  });
});
