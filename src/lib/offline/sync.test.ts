import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingGrade } from './local-review-queue';
import { flushPendingGrades } from './sync';

/**
 * Порядок отправки — часть контракта: сервер строит следующее состояние
 * карточки от предыдущего, поэтому очередь идёт по возрастанию `reviewedAt`
 * и останавливается на первой сетевой ошибке. Ответ сервера 4xx означает,
 * что повтор ничего не изменит — такую запись из очереди убираем, иначе она
 * блокирует всё, что за ней. Исключение — 401/403/408/429: это «сейчас не
 * вышло», и выбрасывать оценку нельзя.
 */

vi.mock('./local-review-queue', () => ({
  listPendingGrades: vi.fn(),
  removePendingGrade: vi.fn(),
}));

const queue = await import('./local-review-queue');
const listPendingGrades = vi.mocked(queue.listPendingGrades);
const removePendingGrade = vi.mocked(queue.removePendingGrade);

function grade(id: string, reviewedAt: string): PendingGrade {
  return { id, cardId: `card-${id}`, nodeTitle: 'Узел', rating: 'good', reviewedAt };
}

const first = grade('1', '2026-08-16T10:00:00.000Z');
const second = grade('2', '2026-08-16T10:05:00.000Z');
const third = grade('3', '2026-08-16T10:10:00.000Z');

const ok = () => new Response('{}', { status: 200 });
const serverError = () => new Response('{}', { status: 500 });
const clientError = () => new Response('{}', { status: 409 });
const unauthorized = () => new Response('{}', { status: 401 });
const rateLimited = () => new Response('{}', { status: 429 });

/** Сигнатура фиксируется явно, иначе `mock.calls` выводится как пустой кортеж. */
function fetchMockOf(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.fn(handler);
}

beforeEach(() => {
  vi.clearAllMocks();
  removePendingGrade.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('flushPendingGrades', () => {
  it('пустая очередь: ни одного запроса', async () => {
    listPendingGrades.mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await flushPendingGrades()).toEqual({ synced: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('отправляет все записи в порядке очереди и чистит их', async () => {
    listPendingGrades.mockResolvedValue([first, second, third]);
    const fetchMock = fetchMockOf(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    expect(await flushPendingGrades()).toEqual({ synced: 3, failed: 0 });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/review/cards/card-1/grade',
      '/api/review/cards/card-2/grade',
      '/api/review/cards/card-3/grade',
    ]);
    expect(removePendingGrade.mock.calls.map((call) => call[0])).toEqual(['1', '2', '3']);
  });

  it('шлёт rating и reviewedAt из записи', async () => {
    listPendingGrades.mockResolvedValue([first]);
    const fetchMock = fetchMockOf(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    await flushPendingGrades();
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      rating: 'good',
      reviewedAt: first.reviewedAt,
    });
  });

  it('обрыв сети: останавливается на первой записи, очередь сохраняется', async () => {
    listPendingGrades.mockResolvedValue([first, second, third]);
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await flushPendingGrades()).toEqual({ synced: 0, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(removePendingGrade).not.toHaveBeenCalled();
  });

  it('5xx: останавливается, запись остаётся на следующую попытку', async () => {
    listPendingGrades.mockResolvedValue([first, second]);
    const fetchMock = vi.fn(async () => serverError());
    vi.stubGlobal('fetch', fetchMock);

    expect(await flushPendingGrades()).toEqual({ synced: 0, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(removePendingGrade).not.toHaveBeenCalled();
  });

  it('4xx: запись выбрасывается и очередь идёт дальше', async () => {
    listPendingGrades.mockResolvedValue([first, second]);
    const fetchMock = fetchMockOf(async (url) => (String(url).includes('card-1') ? clientError() : ok()));
    vi.stubGlobal('fetch', fetchMock);

    expect(await flushPendingGrades()).toEqual({ synced: 2, failed: 0 });
    expect(removePendingGrade.mock.calls.map((call) => call[0])).toEqual(['1', '2']);
  });

  it('401: очередь сохраняется — сессия истекла, пока человек был офлайн', async () => {
    listPendingGrades.mockResolvedValue([first, second]);
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);

    expect(await flushPendingGrades()).toEqual({ synced: 0, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(removePendingGrade).not.toHaveBeenCalled();
  });

  it('429: очередь сохраняется — повторить можно позже', async () => {
    listPendingGrades.mockResolvedValue([first]);
    const fetchMock = vi.fn(async () => rateLimited());
    vi.stubGlobal('fetch', fetchMock);

    expect(await flushPendingGrades()).toEqual({ synced: 0, failed: 1 });
    expect(removePendingGrade).not.toHaveBeenCalled();
  });

  it('успевшие уйти записи удаляются, даже если следующая сорвалась', async () => {
    listPendingGrades.mockResolvedValue([first, second, third]);
    const fetchMock = fetchMockOf(async (url) => {
      if (String(url).includes('card-2')) throw new TypeError('Failed to fetch');
      return ok();
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await flushPendingGrades()).toEqual({ synced: 1, failed: 1 });
    expect(removePendingGrade.mock.calls.map((call) => call[0])).toEqual(['1']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
