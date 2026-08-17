import { listPendingGrades, removePendingGrade, type PendingGrade } from './local-review-queue';

/**
 * Отправляет накопленные офлайн-оценки на сервер по одной, по порядку
 * времени — порядок важен, `applyReview` строит следующее состояние карточки
 * от предыдущего. Останавливается на первой ошибке сети (не 4xx/5xx от
 * сервера — тот всё равно двигает состояние вперёд, ошибку логируем и
 * убираем из очереди, чтобы не блокировать остальные).
 */

export type SyncResult = { synced: number; failed: number };

/**
 * Коды, при которых оценку нельзя выбрасывать из очереди: они означают «сейчас
 * не вышло», а не «запрос неверный». Особенно 401 — сессия истекает, пока
 * человек занимается офлайн, и первая же попытка отправки после возвращения в
 * сеть попадала бы на страницу входа, а накопленные повторения молча пропадали.
 */
const RETRYABLE_STATUSES = new Set([401, 403, 408, 429]);

async function submitGrade(grade: PendingGrade): Promise<boolean> {
  try {
    const response = await fetch(`/api/review/cards/${grade.cardId}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: grade.rating, reviewedAt: grade.reviewedAt }),
    });
    if (response.ok) return true;
    if (response.status >= 500 || RETRYABLE_STATUSES.has(response.status)) return false;
    // Остальные 4xx повтором не исправить (карточка удалена, тело не прошло
    // валидацию) — убираем из очереди, иначе она блокируется навсегда.
    return true;
  } catch {
    return false;
  }
}

export async function flushPendingGrades(): Promise<SyncResult> {
  const pending = await listPendingGrades();
  let synced = 0;
  let failed = 0;
  for (const grade of pending) {
    const ok = await submitGrade(grade);
    if (ok) {
      await removePendingGrade(grade.id);
      synced += 1;
    } else {
      failed += 1;
      break;
    }
  }
  return { synced, failed };
}

let listenerAttached = false;

/** Вешает `online`-слушатель один раз за жизнь вкладки. */
export function registerSyncOnReconnect(onDone?: (result: SyncResult) => void): void {
  if (listenerAttached || typeof window === 'undefined') return;
  listenerAttached = true;
  window.addEventListener('online', () => {
    void flushPendingGrades().then(onDone);
  });
}
