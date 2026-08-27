import {
  listNoteOps,
  removeDraft,
  removeNoteOp,
  saveDraft,
  type PendingNoteOp,
} from './note-queue';

/**
 * Отправка накопленных офлайн операций с заметками.
 *
 * Главное правило: пользовательский текст не теряется никогда. Из него следуют
 * все решения ниже — в том числе неудобные (лишняя «конфликтная копия» вместо
 * тихой перезаписи) и скучные (401 не выбрасывает операцию из очереди, потому
 * что означает «сейчас не вышло», а не «запрос неверный»).
 */

export type NoteSyncOutcome =
  /** Сервер принял — операцию можно убрать из очереди. */
  | { kind: 'done' }
  /** Временный отказ: сеть, 5xx, истёкшая сессия. Пробуем позже, порядок держим. */
  | { kind: 'retry' }
  /** Расхождение версий: сохраняем обе стороны, разбирает человек. */
  | { kind: 'conflict'; serverVersion: number; suggestedTitle: string | null }
  /** Повтором не исправить (заметка удалена, тело невалидно) — не блокируем очередь. */
  | { kind: 'drop'; reason: string };

/**
 * Коды, при которых операцию нельзя выбрасывать. 401 здесь по той же причине,
 * что и в очереди оценок: сессия истекает, пока человек пишет офлайн, и первая
 * же попытка после возвращения в сеть уносила бы заметки в никуда.
 */
const RETRYABLE = new Set([401, 403, 408, 425, 429]);

export function classifyNoteSyncResponse(
  status: number,
  body: unknown,
): NoteSyncOutcome {
  if (status >= 200 && status < 300) return { kind: 'done' };

  if (status === 409) {
    const parsed = body as
      | { error?: { code?: string }; serverVersion?: number; suggestedConflictTitle?: string }
      | null;
    if (parsed?.error?.code === 'VERSION_CONFLICT') {
      return {
        kind: 'conflict',
        serverVersion: typeof parsed.serverVersion === 'number' ? parsed.serverVersion : 0,
        suggestedTitle: parsed.suggestedConflictTitle ?? null,
      };
    }
    // Другой 409 (например, «уже существует») повтором не лечится.
    return { kind: 'drop', reason: 'conflict_not_versioned' };
  }

  if (status === 404) return { kind: 'drop', reason: 'not_found' };
  if (status >= 500 || RETRYABLE.has(status)) return { kind: 'retry' };
  return { kind: 'drop', reason: `http_${status}` };
}

export type NoteSyncResult = {
  synced: number;
  conflicts: number;
  dropped: number;
  pending: number;
};

type Fetcher = typeof fetch;

async function send(op: PendingNoteOp, doFetch: Fetcher): Promise<{ status: number; body: unknown }> {
  if (op.kind === 'delete') {
    const res = await doFetch(`/api/notes/${op.noteId}`, { method: 'DELETE' });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const url = op.kind === 'create' ? '/api/notes' : `/api/notes/${op.noteId}`;
  const method = op.kind === 'create' ? 'POST' : 'PATCH';
  const body =
    op.kind === 'create'
      ? { ...op.body, id: op.noteId }
      : { ...op.body, version: op.baseVersion };

  const res = await doFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * Конфликтная копия создаётся ЛОКАЛЬНО и тут же ставится в очередь на
 * отправку как новая заметка. Так текст человека оказывается в двух местах
 * сразу — и на устройстве, и (после отправки) на сервере, — а серверная
 * версия остаётся нетронутой.
 */
async function forkConflict(
  op: Extract<PendingNoteOp, { kind: 'update' }>,
  outcome: Extract<NoteSyncOutcome, { kind: 'conflict' }>,
  doFetch: Fetcher,
): Promise<boolean> {
  const copyId = crypto.randomUUID();
  const title =
    outcome.suggestedTitle ??
    `${String(op.body.title ?? 'Без названия')} (конфликтная копия)`;

  const res = await doFetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...op.body,
      id: copyId,
      title,
      conflictOfNoteId: op.noteId,
    }),
  });

  if (!res.ok) {
    // Отправить копию не вышло — оставляем её как локальный черновик.
    // Пропасть текст не должен даже в этом случае.
    await saveDraft({
      id: copyId,
      title,
      contentMd: String(op.body.contentMd ?? ''),
      type: String(op.body.type ?? 'capture'),
      nodeId: (op.body.nodeId as string | null) ?? null,
      updatedAt: new Date().toISOString(),
      pending: true,
    });
    return false;
  }

  return true;
}

export async function flushPendingNotes(doFetch: Fetcher = fetch): Promise<NoteSyncResult> {
  const ops = await listNoteOps();
  const result: NoteSyncResult = { synced: 0, conflicts: 0, dropped: 0, pending: 0 };

  for (const [index, op] of ops.entries()) {
    let response: { status: number; body: unknown };
    try {
      response = await send(op, doFetch);
    } catch {
      // Сеть отвалилась: всё, что дальше по очереди, тоже не уйдёт — и уйти
      // не должно, порядок операций над одной заметкой значим.
      result.pending = ops.length - index;
      return result;
    }

    const outcome = classifyNoteSyncResponse(response.status, response.body);

    if (outcome.kind === 'retry') {
      result.pending = ops.length - index;
      return result;
    }

    if (outcome.kind === 'conflict' && op.kind === 'update') {
      await forkConflict(op, outcome, doFetch);
      result.conflicts += 1;
      await removeNoteOp(op.id);
      continue;
    }

    if (outcome.kind === 'drop') {
      result.dropped += 1;
      await removeNoteOp(op.id);
      continue;
    }

    result.synced += 1;
    await removeNoteOp(op.id);
    // Черновик дожил до подтверждения сервером — локальная копия больше не нужна.
    if (op.kind !== 'delete') await removeDraft(op.noteId);
  }

  return result;
}
