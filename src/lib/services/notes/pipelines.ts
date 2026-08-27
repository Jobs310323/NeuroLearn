/**
 * Пайплайны «мысль → действие».
 *
 * Тетрадь ценна не тем, что в ней хранятся мысли, а тем, что мысль из неё
 * выходит обратно в работу. Каждый пайплайн — детерминированное превращение
 * заметки в заготовку следующего шага: идея становится префиллом
 * N-of-1 эксперимента, вопрос — затравкой сократического диалога, флаг «не
 * понял» — строкой реестра.
 *
 * Всё чистыми функциями и без модели. Причина не в экономии лимита: заготовка,
 * сочинённая моделью, выглядит убедительнее, чем есть, и человек принимает её
 * не читая. Здесь заготовка нарочно скучная — она составлена из его же слов и
 * требует правки.
 */

export type IdeaNote = {
  id: string;
  title: string | null;
  contentMd: string;
  nodeId: string | null;
};

/**
 * Переменные, которые эксперимент умеет менять. Совпадают с тем, что реально
 * читает подбор практики: предлагать проверить то, чем система не управляет,
 * — обман.
 */
export const EXPERIMENT_VARIABLES = [
  'interleaveRatio',
  'requestRetention',
  'itemCount',
  'feedbackPolicy',
] as const;

export type ExperimentVariable = (typeof EXPERIMENT_VARIABLES)[number];

export type ExperimentDraft = {
  hypothesis: string;
  variable: ExperimentVariable;
  armA: Record<string, unknown>;
  armB: Record<string, unknown>;
  metric: string;
  windowDays: number;
  nodeId: string | null;
  sourceNoteId: string;
};

/** Слова-подсказки, по которым угадывается переменная. Регистр не важен. */
const VARIABLE_HINTS: [RegExp, ExperimentVariable][] = [
  [/перемеш|интерлив|interleav|mezcl/i, 'interleaveRatio'],
  [/удержан|retention|интервал|забыва/i, 'requestRetention'],
  [/длин|количеств|сколько заданий|itemcount|объём/i, 'itemCount'],
  [/обратн[ао][яй] связ|feedback|разбор сразу|отложенн/i, 'feedbackPolicy'],
];

const DEFAULT_ARMS: Record<ExperimentVariable, { a: Record<string, unknown>; b: Record<string, unknown> }> = {
  // Ветка A — текущее поведение по умолчанию, B — заметно другое.
  // Разница должна быть различима на глаз, иначе эффект утонет в шуме.
  interleaveRatio: { a: { interleaveRatio: 0.2 }, b: { interleaveRatio: 0.6 } },
  requestRetention: { a: { requestRetention: 0.9 }, b: { requestRetention: 0.8 } },
  itemCount: { a: { itemCount: 10 }, b: { itemCount: 20 } },
  feedbackPolicy: {
    a: { feedbackPolicy: 'force_instant' },
    b: { feedbackPolicy: 'force_delayed' },
  },
};

/**
 * Первая осмысленная строка заметки. Заголовок бывает пустым (быстрый
 * перехват), и тогда гипотезу лучше собрать из текста, чем оставить пустой.
 */
export function firstLine(contentMd: string, maxLength = 200): string {
  const line = contentMd
    .split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .find((l) => l.length > 0);
  if (!line) return '';
  return line.length <= maxLength ? line : `${line.slice(0, maxLength - 1)}…`;
}

export function guessVariable(text: string): ExperimentVariable {
  for (const [pattern, variable] of VARIABLE_HINTS) {
    if (pattern.test(text)) return variable;
  }
  // Умолчание — доля перемешивания: это самая обсуждаемая и самая проверяемая
  // переменная практики, и ошибиться здесь дешевле всего.
  return 'interleaveRatio';
}

/**
 * `metric` всегда `delayed_accuracy`: сравнивать ветки по результату самой
 * сессии бессмысленно — желательные трудности ухудшают её и улучшают
 * отложенное удержание, и метрика «по сессии» систематически выбирала бы
 * худшую ветку.
 */
export function draftExperimentFromIdea(note: IdeaNote): ExperimentDraft {
  const seed = note.title?.trim() || firstLine(note.contentMd);
  const variable = guessVariable(`${note.title ?? ''} ${note.contentMd}`);
  const arms = DEFAULT_ARMS[variable];

  return {
    hypothesis: seed || 'Сформулируйте проверяемое утверждение своими словами',
    variable,
    armA: arms.a,
    armB: arms.b,
    metric: 'delayed_accuracy',
    windowDays: 7,
    nodeId: note.nodeId,
    sourceNoteId: note.id,
  };
}

export type TutorSeed = {
  nodeId: string | null;
  /** Первая реплика человека в диалоге — его собственный вопрос. */
  openingMessage: string;
  title: string;
  sourceNoteId: string;
};

/**
 * Вопрос → очередь сократического тьютора.
 *
 * В диалог уходит вопрос человека дословно, а не пересказ: тьютор обязан
 * отвечать вопросами на то, что спросили, а не на то, как это переформулировала
 * система.
 */
export function seedTutorFromQuestion(note: IdeaNote): TutorSeed {
  const body = note.contentMd.trim();
  const title = note.title?.trim() || firstLine(body) || 'Вопрос из тетради';

  return {
    nodeId: note.nodeId,
    openingMessage: body || title,
    title: title.length > 80 ? `${title.slice(0, 79)}…` : title,
    sourceNoteId: note.id,
  };
}

/**
 * Реестр непонимания: недельная сводка помеченных заметок.
 *
 * Группировка по узлу, а не по дате: непонимание — свойство темы, и три
 * пометки на одном узле за неделю значат совсем не то же, что три пометки на
 * трёх разных.
 */
export type ConfusionEntry = {
  noteId: string;
  title: string | null;
  nodeId: string | null;
  nodeTitle: string | null;
  createdAt: Date;
};

export type ConfusionCluster = {
  nodeId: string | null;
  nodeTitle: string;
  count: number;
  entries: ConfusionEntry[];
  /** Три и больше пометок на одном узле — повод для контрастных заданий. */
  suggestsContrast: boolean;
};

export const CONTRAST_SUGGESTION_THRESHOLD = 3;

export function clusterConfusions(entries: ConfusionEntry[]): ConfusionCluster[] {
  const buckets = new Map<string, ConfusionEntry[]>();
  for (const entry of entries) {
    const key = entry.nodeId ?? '__none__';
    const list = buckets.get(key);
    if (list) list.push(entry);
    else buckets.set(key, [entry]);
  }

  return [...buckets.entries()]
    .map(([key, list]) => ({
      nodeId: key === '__none__' ? null : key,
      nodeTitle: list[0]?.nodeTitle ?? 'Без узла',
      count: list.length,
      entries: [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      suggestsContrast: key !== '__none__' && list.length >= CONTRAST_SUGGESTION_THRESHOLD,
    }))
    .sort((a, b) => b.count - a.count || a.nodeTitle.localeCompare(b.nodeTitle));
}
