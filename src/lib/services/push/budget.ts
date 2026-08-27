/**
 * Бюджет тишины: сколько уведомлений каждой категории допустимо за неделю.
 *
 * Смысл не в вежливости, а в сохранении сигнала. Уведомление работает ровно до
 * тех пор, пока его читают; приложение, которое пишет каждый день, обучает
 * смахивать себя не глядя — и тогда действительно важное сообщение («узел
 * просел», «капсула вернулась») тоже не будет прочитано. Ограничение защищает
 * не человека от приложения, а канал от обесценивания.
 *
 * Лимиты разные по категориям, потому что события разной редкости. Просроченные
 * повторения — регулярное состояние, и напоминать о них ежедневно осмысленно.
 * Капсула времени возвращается раз в месяц, и её сообщение обязано пройти
 * всегда, даже если бюджет остальных исчерпан.
 *
 * Модуль чистый: политика проверяется тестом, а не наблюдением за тем, сколько
 * писем пришло за неделю.
 */

export const PUSH_CATEGORIES = [
  /** Подошли по сроку повторения. */
  'review_due',
  /** Прочность узла заметно просела. */
  'node_weak',
  /** Эксперимент N-of-1 набрал данные и готов к разбору. */
  'experiment_ready',
  /** Вернулась капсула времени. */
  'note_capsule',
] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** Максимум уведомлений категории за скользящую неделю. */
export const WEEKLY_BUDGET: Record<PushCategory, number> = {
  review_due: 7,
  node_weak: 2,
  experiment_ready: 2,
  // Капсулу человек назначил сам, на конкретную дату. Не доставить её —
  // нарушить его же договорённость с собой, поэтому лимит велик.
  note_capsule: 7,
};

export const CATEGORY_LABEL: Record<PushCategory, string> = {
  review_due: 'Повторения по сроку',
  node_weak: 'Просевшие узлы',
  experiment_ready: 'Эксперимент готов к разбору',
  note_capsule: 'Вернувшаяся капсула времени',
};

export type SentRecord = { category: PushCategory; at: Date };

export type BudgetState = {
  category: PushCategory;
  used: number;
  limit: number;
  remaining: number;
};

const WEEK_MS = 7 * 86_400_000;

export function budgetState(
  sent: SentRecord[],
  now = new Date(),
): BudgetState[] {
  const since = now.getTime() - WEEK_MS;

  return PUSH_CATEGORIES.map((category) => {
    const used = sent.filter(
      (record) => record.category === category && record.at.getTime() >= since,
    ).length;
    const limit = WEEKLY_BUDGET[category];
    return { category, used, limit, remaining: Math.max(0, limit - used) };
  });
}

export function canSend(
  category: PushCategory,
  sent: SentRecord[],
  now = new Date(),
): boolean {
  const state = budgetState(sent, now).find((item) => item.category === category);
  return (state?.remaining ?? 0) > 0;
}

/**
 * Отбор того, что реально отправится.
 *
 * Категории обрабатываются в порядке важности, а не в порядке поступления:
 * когда бюджета хватает не на всё, уходить должно то, что человек назначил
 * сам (капсула), а не рутинное напоминание о повторениях.
 *
 * Внутри одной категории отправляется не более одного уведомления за прогон:
 * три сообщения подряд об одном и том же — это одно сообщение и два раздражителя.
 */
const PRIORITY: PushCategory[] = [
  'note_capsule',
  'experiment_ready',
  'node_weak',
  'review_due',
];

export type Candidate<T> = { category: PushCategory; payload: T };

export function selectSendable<T>(
  candidates: Candidate<T>[],
  sent: SentRecord[],
  now = new Date(),
): Candidate<T>[] {
  const remaining = new Map(
    budgetState(sent, now).map((state) => [state.category, state.remaining]),
  );
  const selected: Candidate<T>[] = [];

  for (const category of PRIORITY) {
    if ((remaining.get(category) ?? 0) <= 0) continue;
    const candidate = candidates.find((item) => item.category === category);
    if (!candidate) continue;
    selected.push(candidate);
    remaining.set(category, (remaining.get(category) ?? 0) - 1);
  }

  return selected;
}
