/**
 * Итог недели и детектор противоречий — детерминированная часть.
 *
 * Здесь считается всё, что можно посчитать: связность заметок, глубина против
 * мимолётности, кандидаты в противоречия. Модель получает уже отобранные
 * факты и пишет по ним связный текст — черновик, который человек правит.
 *
 * Разделение принципиальное. Модель, которой отдали сырые заметки и попросили
 * «найти противоречия», найдёт их в любом случае: это её работа — находить
 * связи, а не признавать, что связей нет. Отбор кандидатов правилами
 * гарантирует, что противоречие названо только там, где есть измеримое
 * расхождение между тем, что человек записал, и тем, что показывает практика.
 */

export type WeekNote = {
  id: string;
  type: string;
  title: string | null;
  contentMd: string;
  nodeId: string | null;
  createdAt: Date;
  linkCount: number;
  confusionFlag: boolean;
};

export type WeekStats = {
  total: number;
  byType: Record<string, number>;
  /** Доля заметок, связанных хотя бы с одной другой. */
  connectedShare: number;
  /**
   * Доля «глубоких» — тех, что длиннее порога и/или связаны. Не оценка
   * человека: короткая мысль на ходу — законный жанр, ради которого захват и
   * сделан. Число отвечает на вопрос «дошли ли перехваты до разбора».
   */
  deepShare: number;
  medianLength: number;
  confusionCount: number;
  /** Узлы, по которым за неделю накопилось больше всего заметок. */
  topNodes: { nodeId: string; count: number }[];
};

/** Длиннее этого заметку считаем разобранной, а не перехваченной на ходу. */
export const DEEP_LENGTH = 280;

export function summarizeWeek(notes: WeekNote[]): WeekStats {
  if (notes.length === 0) {
    return {
      total: 0,
      byType: {},
      connectedShare: 0,
      deepShare: 0,
      medianLength: 0,
      confusionCount: 0,
      topNodes: [],
    };
  }

  const byType: Record<string, number> = {};
  for (const note of notes) byType[note.type] = (byType[note.type] ?? 0) + 1;

  const lengths = notes.map((note) => note.contentMd.trim().length).sort((a, b) => a - b);
  const middle = Math.floor(lengths.length / 2);
  const medianLength =
    lengths.length % 2 === 0
      ? Math.round((lengths[middle - 1]! + lengths[middle]!) / 2)
      : lengths[middle]!;

  const connected = notes.filter((note) => note.linkCount > 0).length;
  const deep = notes.filter(
    (note) => note.contentMd.trim().length >= DEEP_LENGTH || note.linkCount > 0,
  ).length;

  const nodeCounts = new Map<string, number>();
  for (const note of notes) {
    if (!note.nodeId) continue;
    nodeCounts.set(note.nodeId, (nodeCounts.get(note.nodeId) ?? 0) + 1);
  }

  return {
    total: notes.length,
    byType,
    connectedShare: connected / notes.length,
    deepShare: deep / notes.length,
    medianLength,
    confusionCount: notes.filter((note) => note.confusionFlag).length,
    topNodes: [...nodeCounts.entries()]
      .map(([nodeId, count]) => ({ nodeId, count }))
      .sort((a, b) => b.count - a.count || a.nodeId.localeCompare(b.nodeId))
      .slice(0, 5),
  };
}

// --- Детектор противоречий ----------------------------------------------

export type NodeEvidence = {
  nodeId: string;
  nodeTitle: string;
  status: string;
  accuracyRate: number;
  totalReps: number;
};

export type ContradictionCandidate = {
  noteId: string;
  noteTitle: string | null;
  nodeId: string;
  nodeTitle: string;
  /** Измеримое основание — оно же показывается человеку. */
  evidence: string;
  accuracyRate: number;
};

/**
 * Минимум повторений, ниже которого о расхождении говорить нельзя: две
 * ошибки из трёх — это не «практика показывает пробел», это три ответа.
 */
export const MIN_REPS_FOR_CONTRADICTION = 8;

/** Точность, ниже которой расхождение с уверенной заметкой считается реальным. */
export const CONTRADICTION_ACCURACY = 0.6;

/**
 * Границы слова заданы через `\p{L}`, а не через `\b`.
 *
 * `\b` в JavaScript определяется через `\w`, то есть `[A-Za-z0-9_]`: для
 * кириллицы он срабатывает наоборот — «разобрался» не совпадает с шаблоном
 * `\bразобрал\b`, потому что после «разобрал» идёт буква, которая для движка
 * не буква. Молчаливый детектор противоречий выглядел бы как «противоречий
 * нет», и ошибку было бы не видно.
 *
 * Хвост слова не ограничивается намеренно: это стем, и «разобрался»,
 * «разобралась», «разобрали» — одно и то же утверждение.
 */
const START = '(?<!\\p{L})';

/**
 * Обороты уверенности. Заметка «кажется, я не до конца понял» с низкой
 * точностью по узлу — не противоречие, а совпадение; противоречие — это
 * «разобрался» при точности 40%.
 */
const CONFIDENT_CLAIM = new RegExp(
  `${START}(?:разобрал|понял|поняла|ясно|очевидно|усвоил|усвоила|запомнил|запомнила|got it|understood|entiendo|claro)`,
  'iu',
);

/** Оговорки, снимающие уверенность: «кажется понял» — это не утверждение. */
const HEDGE = new RegExp(
  `${START}(?:кажется|вроде|наверн|похоже|не уверен|не до конца|почти|maybe|seems|quizás|parece)`,
  'iu',
);

export function findContradictions(
  notes: WeekNote[],
  evidence: NodeEvidence[],
): ContradictionCandidate[] {
  const byNode = new Map(evidence.map((item) => [item.nodeId, item]));

  return notes
    .flatMap((note) => {
      if (!note.nodeId) return [];
      // Помеченная непониманием заметка и низкая точность — согласие, а не
      // расхождение. Называть это противоречием значит спорить с человеком,
      // который и так всё про себя понял.
      if (note.confusionFlag) return [];

      const node = byNode.get(note.nodeId);
      if (!node) return [];
      if (node.totalReps < MIN_REPS_FOR_CONTRADICTION) return [];
      if (node.accuracyRate >= CONTRADICTION_ACCURACY) return [];

      const text = `${note.title ?? ''} ${note.contentMd}`;
      if (!CONFIDENT_CLAIM.test(text)) return [];
      if (HEDGE.test(text)) return [];

      return [
        {
          noteId: note.id,
          noteTitle: note.title,
          nodeId: node.nodeId,
          nodeTitle: node.nodeTitle,
          evidence: `точность по узлу ${Math.round(node.accuracyRate * 100)}% на ${node.totalReps} ответах`,
          accuracyRate: node.accuracyRate,
        },
      ];
    })
    .sort((a, b) => a.accuracyRate - b.accuracyRate || a.noteId.localeCompare(b.noteId));
}
