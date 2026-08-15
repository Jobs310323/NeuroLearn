import localforage from 'localforage';

/**
 * Оценки карточек, поставленные офлайн. Пересчёт FSRS остаётся только на
 * сервере (`POST /api/review/cards/:cardId/grade`) — здесь лишь очередь
 * действий на отправку, без дублирования scheduling-логики на клиенте:
 * два независимых расчёта неизбежно разойдутся при накоплении истории.
 */

export type PendingGrade = {
  id: string;
  cardId: string;
  nodeTitle: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  reviewedAt: string;
};

const store = localforage.createInstance({ name: 'neurolearn', storeName: 'pending_grades' });

export async function enqueuePendingGrade(entry: Omit<PendingGrade, 'id'>): Promise<PendingGrade> {
  const item: PendingGrade = { ...entry, id: crypto.randomUUID() };
  await store.setItem(item.id, item);
  return item;
}

export async function listPendingGrades(): Promise<PendingGrade[]> {
  const items: PendingGrade[] = [];
  await store.iterate<PendingGrade, void>((value) => {
    items.push(value);
  });
  return items.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
}

export async function removePendingGrade(id: string): Promise<void> {
  await store.removeItem(id);
}

export async function pendingGradeCount(): Promise<number> {
  return store.length();
}
