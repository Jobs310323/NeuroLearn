import { listPendingGrades, removePendingGrade, type PendingGrade } from './local-review-queue';

/**
 * Отправляет накопленные офлайн-оценки на сервер по одной, по порядку
 * времени — порядок важен, `applyReview` строит следующее состояние карточки
 * от предыдущего. Останавливается на первой ошибке сети (не 4xx/5xx от
 * сервера — тот всё равно двигает состояние вперёд, ошибку логируем и
 * убираем из очереди, чтобы не блокировать остальные).
 */

export type SyncResult = { synced: number; failed: number };

async function submitGrade(grade: PendingGrade): Promise<boolean> {
  try {
    const response = await fetch(`/api/review/cards/${grade.cardId}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: grade.rating, reviewedAt: grade.reviewedAt }),
    });
    if (!response.ok && response.status >= 500) return false;
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
