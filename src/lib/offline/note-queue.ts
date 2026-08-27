import localforage from 'localforage';

/**
 * Очередь операций с заметками, накопленных без сети.
 *
 * Отличие от очереди оценок (`local-review-queue.ts`): там ставится оценка,
 * которую сервер пересчитывает сам, а здесь — авторский текст, который
 * восстановить неоткуда. Поэтому очередь не «пытается отправить и забывает»,
 * а держит запись, пока сервер не подтвердит приём, и при расхождении версий
 * создаёт вторую заметку вместо перезаписи.
 *
 * Идентификаторы генерирует клиент: повтор отправки попадает в тот же
 * первичный ключ, и дублей не будет даже если ответ потерялся по дороге.
 */

export type PendingNoteOp =
  | {
      kind: 'create';
      id: string;
      noteId: string;
      queuedAt: string;
      body: Record<string, unknown>;
    }
  | {
      kind: 'update';
      id: string;
      noteId: string;
      queuedAt: string;
      /** Версия, от которой правил человек. Основание оптимистической блокировки. */
      baseVersion: number;
      body: Record<string, unknown>;
    }
  | { kind: 'delete'; id: string; noteId: string; queuedAt: string };

const store = localforage.createInstance({ name: 'neurolearn', storeName: 'pending_notes' });

/**
 * `Omit` над объединением схлопывает варианты в общие поля — у `update`
 * пропал бы `baseVersion`. Дистрибутивная версия сохраняет каждый вариант.
 */
type DraftOp<T> = T extends unknown ? Omit<T, 'id' | 'queuedAt'> : never;

export async function enqueueNoteOp(op: DraftOp<PendingNoteOp>): Promise<PendingNoteOp> {
  const item = {
    ...op,
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
  } as PendingNoteOp;
  await store.setItem(item.id, item);
  return item;
}

/**
 * Порядок важен: правка после создания той же заметки должна уйти второй,
 * иначе сервер получит `PATCH` на несуществующую строку.
 */
export async function listNoteOps(): Promise<PendingNoteOp[]> {
  const items: PendingNoteOp[] = [];
  await store.iterate<PendingNoteOp, void>((value) => {
    items.push(value);
  });
  return items.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeNoteOp(id: string): Promise<void> {
  await store.removeItem(id);
}

export async function pendingNoteCount(): Promise<number> {
  return store.length();
}

/**
 * Локальные черновики. Хранятся отдельно от очереди: очередь — про доставку,
 * черновик — про то, что человек видит в списке, пока сети нет. Без этого
 * заметка, записанная в метро, исчезала бы с экрана до возвращения связи.
 */
const draftStore = localforage.createInstance({ name: 'neurolearn', storeName: 'note_drafts' });

export type LocalNoteDraft = {
  id: string;
  title: string | null;
  contentMd: string;
  type: string;
  nodeId: string | null;
  updatedAt: string;
  /** Не отправлено на сервер — показываем метку «только на этом устройстве». */
  pending: boolean;
};

export async function saveDraft(draft: LocalNoteDraft): Promise<void> {
  await draftStore.setItem(draft.id, draft);
}

export async function listDrafts(): Promise<LocalNoteDraft[]> {
  const items: LocalNoteDraft[] = [];
  await draftStore.iterate<LocalNoteDraft, void>((value) => {
    items.push(value);
  });
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function removeDraft(id: string): Promise<void> {
  await draftStore.removeItem(id);
}
