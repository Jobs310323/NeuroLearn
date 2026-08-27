import type { NoteColor, NoteRelation, NoteType } from '@/lib/db/schema';

/**
 * Оформление и подписи тетради.
 *
 * Цвет здесь, как и на карте знаний, — канал данных, а не украшение: метка
 * говорит, ЧТО это за мысль (инсайт, вопрос, пробел, противоречие), и по ней
 * же работает фильтр. Поэтому каждый цвет обязан иметь подпись: одним цветом
 * смысл кодировать нельзя.
 */

export const NOTE_TYPE_META: Record<NoteType, { label: string; hint: string }> = {
  capture: {
    label: 'Перехват',
    hint: 'Мысль на ходу. Разобрать позже — это нормально.',
  },
  summary: {
    label: 'Конспект',
    hint: 'Пересказ своими словами. Копия чужого текста конспектом не считается.',
  },
  idea: {
    label: 'Идея',
    hint: 'Догадка о том, как что-то устроено. Её можно проверить экспериментом.',
  },
  reflection: {
    label: 'Рефлексия',
    hint: 'Разбор собственной сессии по фактическим данным.',
  },
  question: {
    label: 'Вопрос',
    hint: 'То, что осталось непонятным. Можно отправить тьютору.',
  },
  quote: { label: 'Цитата', hint: 'Дословно из источника, с указанием места.' },
  link_note: {
    label: 'Связка',
    hint: 'Чем два узла похожи и чем различаются. Основа переноса знания.',
  },
};

export const NOTE_COLOR_META: Record<
  NoteColor,
  { label: string; token: string; description: string }
> = {
  neutral: {
    label: 'Без метки',
    token: 'var(--color-fg-subtle)',
    description: 'Обычная запись.',
  },
  insight: {
    label: 'Инсайт',
    token: 'var(--color-status-mastered)',
    description: 'Понял то, чего не понимал.',
  },
  question: {
    label: 'Вопрос',
    token: 'var(--color-status-needs-review)',
    description: 'Осталось невыясненным.',
  },
  gap: {
    label: 'Пробел',
    token: 'var(--color-status-has-gaps)',
    description: 'Знаю, что не знаю. Зона роста, а не провал.',
  },
  source: {
    label: 'Из источника',
    token: 'var(--color-status-in-progress)',
    description: 'Опирается на конкретный материал.',
  },
  contradiction: {
    label: 'Противоречие',
    token: 'var(--color-accent)',
    description: 'Два утверждения не сходятся между собой.',
  },
};

export const NOTE_RELATION_META: Record<NoteRelation, { label: string; arrow: string }> = {
  supports: { label: 'подтверждает', arrow: '→' },
  contradicts: { label: 'противоречит', arrow: '⇄' },
  extends: { label: 'дополняет', arrow: '→' },
  question_of: { label: 'вопрос к', arrow: '?' },
  example_of: { label: 'пример к', arrow: '↳' },
};

export function noteTypeLabel(type: string): string {
  return (NOTE_TYPE_META as Record<string, { label: string }>)[type]?.label ?? type;
}

export function noteColorToken(color: string): string {
  return (
    (NOTE_COLOR_META as Record<string, { token: string }>)[color]?.token ??
    'var(--color-fg-subtle)'
  );
}

export function noteColorLabel(color: string): string {
  return (NOTE_COLOR_META as Record<string, { label: string }>)[color]?.label ?? color;
}
