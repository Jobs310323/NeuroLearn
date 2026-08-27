/**
 * Планировщик живых заметок.
 *
 * Идея простая и в этом её ценность: заметка возвращается не по своему
 * расписанию, а вслед за знанием, к которому она заякорена. Конспект про
 * интерливинг всплывает тогда, когда узел «Интерливинг» подошёл к повторению,
 * — то есть ровно в момент, когда он снова понадобится.
 *
 * Планировщик полностью детерминированный: чистая функция от состояния
 * карточки FSRS и самой заметки. Отдельного расписания у заметок нет и не
 * должно быть — иначе появились бы две несогласованные очереди, и человек
 * получал бы «перечитайте это» через неделю после того, как узел освоен.
 *
 * Капсулы времени — второй, независимый источник даты: там дату назначает
 * человек, и планировщик её не трогает.
 */

export type NoteScheduleInput = {
  noteId: string;
  /** Уже назначенная дата возврата, если есть. */
  resurfaceAt: Date | null;
  /** Дата назначена капсулой времени: планировщик её не перебивает. */
  isCapsule: boolean;
  /** Заметка заякорена на узел; без якоря возвращать её не к чему. */
  nodeId: string | null;
  isArchived: boolean;
  updatedAt: Date;
};

export type NodeReviewState = {
  nodeId: string;
  /** Ближайшее повторение по FSRS. `null` — карточки ещё нет. */
  due: Date | null;
  status: string;
};

export type ScheduleDecision = {
  noteId: string;
  resurfaceAt: Date | null;
  reason: string | null;
};

/**
 * За сколько до повторения показывать заметку. Ноль был бы бесполезен:
 * заметка должна попасться ДО практики, а не одновременно с ней, иначе
 * перечитывать её человек будет уже после ответов.
 */
const LEAD_TIME_MS = 12 * 60 * 60 * 1000;

/**
 * Статусы, при которых заметку стоит поднять независимо от даты FSRS: знание
 * просело прямо сейчас, и ждать планового повторения незачем.
 */
const URGENT_STATUSES = new Set(['has_gaps', 'needs_review']);

/**
 * Слишком свежая заметка не возвращается: её только что написали, и
 * «перечитайте перед практикой» через час читается как насмешка.
 */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

export function scheduleNote(
  note: NoteScheduleInput,
  node: NodeReviewState | null,
  now = new Date(),
): ScheduleDecision {
  // Капсула — решение человека. Планировщик её не перебивает ни при каких
  // условиях: он про знание, она про намерение, и спорить им не о чем.
  if (note.isCapsule) {
    return { noteId: note.noteId, resurfaceAt: note.resurfaceAt, reason: null };
  }

  if (note.isArchived || !note.nodeId || !node) {
    return { noteId: note.noteId, resurfaceAt: null, reason: null };
  }

  if (now.getTime() - note.updatedAt.getTime() < MIN_AGE_MS) {
    return { noteId: note.noteId, resurfaceAt: null, reason: null };
  }

  if (URGENT_STATUSES.has(node.status)) {
    return {
      noteId: note.noteId,
      resurfaceAt: now,
      reason:
        node.status === 'has_gaps'
          ? 'по узлу есть пробелы'
          : 'узел подошёл к повторению',
    };
  }

  if (!node.due) {
    return { noteId: note.noteId, resurfaceAt: null, reason: null };
  }

  const at = new Date(node.due.getTime() - LEAD_TIME_MS);

  // Повторение уже позади, а статус не тревожный — знание в порядке,
  // поднимать заметку не из-за чего.
  if (at.getTime() < now.getTime() - LEAD_TIME_MS) {
    return { noteId: note.noteId, resurfaceAt: null, reason: null };
  }

  return {
    noteId: note.noteId,
    resurfaceAt: at,
    reason: 'скоро повторение узла',
  };
}

/**
 * Пакетный расчёт. Возвращает только те заметки, у которых дата или причина
 * изменились: писать в базу совпадающие значения — лишние строки в WAL и
 * лишний шум в `updated_at`.
 */
export function scheduleNotes(
  notes: NoteScheduleInput[],
  nodes: NodeReviewState[],
  now = new Date(),
): ScheduleDecision[] {
  const byNode = new Map(nodes.map((node) => [node.nodeId, node]));

  return notes
    .map((note) => scheduleNote(note, note.nodeId ? (byNode.get(note.nodeId) ?? null) : null, now))
    .filter((decision, index) => {
      const previous = notes[index]!.resurfaceAt;
      const next = decision.resurfaceAt;
      if (previous === null && next === null) return false;
      if (previous === null || next === null) return true;
      // Секундная разница — результат пересчёта того же самого, а не новое решение.
      return Math.abs(previous.getTime() - next.getTime()) > 1000;
    });
}

/**
 * Сколько заметок показывать перед сессией. Больше двух — это уже чтение
 * вместо практики, а практика здесь главная.
 */
export const MAX_NOTES_BEFORE_SESSION = 2;

/**
 * Отбор заметок для блока «Перечитать перед практикой»: сначала помеченные
 * непониманием (они точно про то, что не даётся), затем самые просроченные.
 */
export function pickNotesForSession<
  T extends { resurfaceAt: Date | null; confusionFlag: boolean },
>(notes: T[], now = new Date(), limit = MAX_NOTES_BEFORE_SESSION): T[] {
  return notes
    .filter((note) => note.resurfaceAt !== null && note.resurfaceAt.getTime() <= now.getTime())
    .sort((a, b) => {
      if (a.confusionFlag !== b.confusionFlag) return a.confusionFlag ? -1 : 1;
      return (a.resurfaceAt as Date).getTime() - (b.resurfaceAt as Date).getTime();
    })
    .slice(0, limit);
}
