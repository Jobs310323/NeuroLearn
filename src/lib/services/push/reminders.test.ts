import { describe, expect, it } from 'vitest';

import {
  capsuleMessage,
  experimentReadyMessage,
  nodeWeakMessage,
  reviewDueMessage,
} from './reminders';

/**
 * Уведомления — самая заметная часть тона продукта и единственная его часть,
 * которая приходит без спроса. Приложение без геймификации не может давить в
 * этом канале: это та же механика удержания, только в другом месте.
 */
describe('тексты уведомлений', () => {
  const all = [
    reviewDueMessage(12),
    nodeWeakMessage('Интерливинг', 40),
    experimentReadyMessage('Перемешивание помогает мне сильнее'),
    capsuleMessage('Через месяц буду решать без подсказок'),
  ];

  it('не упрекают за пропуски и не подгоняют', () => {
    const forbidden = [
      /пропустил/i,
      /не заходил/i,
      /давно не/i,
      /срочно/i,
      /скорее/i,
      /стрик/i,
      /подряд дней/i,
      /молодец/i,
    ];
    for (const message of all) {
      const text = `${message.title} ${message.body}`;
      for (const pattern of forbidden) {
        expect(text, `${text} нарушает ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('каждое ведёт на конкретный экран, а не на главную', () => {
    for (const message of all) {
      expect(message.url.startsWith('/')).toBe(true);
      expect(message.url).not.toBe('/');
    }
  });

  it('заголовок короткий: длинный обрезается системой на полуслове', () => {
    for (const message of all) expect(message.title.length).toBeLessThanOrEqual(40);
  });

  it('пробел назван зоной роста, а не провалом', () => {
    expect(nodeWeakMessage('Тема', 30).body).toContain('зона роста');
  });

  it('длинная гипотеза обрезается, а не ломает уведомление', () => {
    const long = 'я'.repeat(300);
    const message = experimentReadyMessage(long);
    expect(message.body.length).toBeLessThan(160);
    expect(message.body).toContain('…');
  });

  it('счёт повторений объясняет, почему не раньше', () => {
    expect(reviewDueMessage(5).body).toContain('расписание');
  });
});
