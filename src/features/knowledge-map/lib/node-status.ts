import type { CitationKey } from '@/lib/science/citations';

export type NodeStatus =
  | 'not_started'
  | 'in_progress'
  | 'mastered'
  | 'needs_review'
  | 'has_gaps'
  | 'automated';

/**
 * Оформление статусов узла.
 *
 * Статус кодируется не только цветом, но и подписью с иконкой — цвет один
 * не должен нести смысл (доступность). Пробел — янтарный, не красный:
 * по PRD пробел это зона роста, а не провал.
 */
export const NODE_STATUS_META: Record<
  NodeStatus,
  {
    label: string;
    color: string;
    ring: string;
    text: string;
    hint: string;
    citation?: CitationKey;
  }
> = {
  not_started: {
    label: 'Не начат',
    color: 'var(--color-status-not-started)',
    ring: 'transparent',
    text: 'var(--color-fg-subtle)',
    hint: 'Начинается с теста, а не с теории.',
    citation: 'pretesting',
  },
  in_progress: {
    label: 'В работе',
    color: 'var(--color-status-in-progress)',
    ring: 'transparent',
    text: 'var(--color-status-in-progress)',
    hint: 'Идёт практика. Мастерство требует минимум двух дней с разрывом.',
    citation: 'spacing_effect',
  },
  has_gaps: {
    label: 'Есть пробелы',
    color: 'var(--color-status-has-gaps)',
    ring: 'transparent',
    text: 'var(--color-status-has-gaps)',
    hint: 'Точность ниже половины. Это зона роста, а не провал.',
    citation: 'desirable_difficulties',
  },
  mastered: {
    label: 'Освоен',
    color: 'var(--color-status-mastered)',
    ring: 'transparent',
    text: 'var(--color-status-mastered)',
    hint: 'Прочность ≥ 80 и заполнен дневник обучения.',
    citation: 'metacognition',
  },
  automated: {
    label: 'Автоматизм',
    color: 'var(--color-status-automated)',
    ring: 'var(--color-status-automated)',
    text: 'var(--color-status-automated)',
    hint: 'Быстро и верно на разнесённых во времени повторениях.',
    citation: 'automaticity',
  },
  needs_review: {
    label: 'Нужно повторить',
    color: 'var(--color-status-needs-review)',
    ring: 'var(--color-status-needs-review)',
    text: 'var(--color-status-needs-review)',
    hint: 'Подошёл срок повторения по расписанию FSRS.',
    citation: 'fsrs',
  },
};

export const NODE_STATUS_ORDER: NodeStatus[] = [
  'not_started',
  'in_progress',
  'has_gaps',
  'mastered',
  'automated',
  'needs_review',
];

export function isNodeStatus(value: string): value is NodeStatus {
  return value in NODE_STATUS_META;
}
