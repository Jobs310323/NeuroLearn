import type { PushCategory } from './budget';

/**
 * Тексты уведомлений по категориям.
 *
 * Вынесены отдельно от рассылки по двум причинам. Первая техническая: их
 * формулировка не зависит ни от базы, ни от времени, и проверяется тестом.
 * Вторая важнее: тексты уведомлений — самая заметная часть тона продукта, и
 * держать их рядом с циклом отправки значит править их случайно.
 *
 * Общее правило формулировок: сообщать факт и его основание, не подгонять.
 * «Вы пропустили 3 дня» — упрёк; «Подошли по сроку: 12 карточек» — факт, из
 * которого человек сам решает, что делать. Приложение без геймификации не
 * может позволить себе давить в уведомлениях: это та же механика удержания,
 * только в другом канале.
 */

export type ReminderPayload = { title: string; body: string; url: string };

export function reviewDueMessage(count: number): ReminderPayload {
  return {
    title: 'Пора повторить',
    body: `Подошло по сроку: ${count}. Раньше срока приходить незачем — это и есть расписание.`,
    url: '/review',
  };
}

export function nodeWeakMessage(nodeTitle: string, strength: number): ReminderPayload {
  return {
    title: 'Узел просел',
    body: `«${nodeTitle}»: прочность ${strength} из 100. Это зона роста, а не провал.`,
    url: '/review',
  };
}

export function experimentReadyMessage(hypothesis: string): ReminderPayload {
  return {
    title: 'Эксперимент готов к разбору',
    body: `Данных достаточно, чтобы посмотреть результат: «${truncate(hypothesis, 90)}».`,
    url: '/analytics',
  };
}

export function capsuleMessage(noteTitle: string): ReminderPayload {
  return {
    title: 'Капсула времени вернулась',
    body: `«${truncate(noteTitle, 90)}» — вы просили напомнить. Сбылось?`,
    url: '/notes?due=1',
  };
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** Соответствие категории и её сборщика — для перебора в рассылке. */
export const CATEGORY_URL: Record<PushCategory, string> = {
  review_due: '/review',
  node_weak: '/review',
  experiment_ready: '/analytics',
  note_capsule: '/notes?due=1',
};
