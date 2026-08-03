/**
 * Типы JSONB-полей. Каждый из них дублируется Zod-схемой в
 * `src/lib/validation/*` — Zod валидирует вход (особенно ответы LLM),
 * эти типы дают строгость на чтении из БД.
 */

/** Агрегированный когнитивный портрет пользователя. Обновляет ProgressAnalyzer. */
export type CognitiveProfile = {
  /** Медианное время реакции по всем верным ответам, мс. */
  avgResponseTimeMs: number | null;
  /** Доля удержания на отложенных проверках, 0..1. */
  retentionIndex: number | null;
  /** Насколько агрессивно вводить желательные трудности. */
  desirableDifficulty: 'low' | 'medium' | 'high';
  /** Смещение калибровки: mean(confidence) - mean(accuracy), -1..1. >0 = переоценка себя. */
  calibrationBias: number | null;
  /** Устойчивость к интерливингу, 0..1. Ниже — мягче перемешивание. */
  interleavingTolerance: number;
  preferredSessionMinutes: number;
};

export const DEFAULT_COGNITIVE_PROFILE: CognitiveProfile = {
  avgResponseTimeMs: null,
  retentionIndex: null,
  desirableDifficulty: 'medium',
  calibrationBias: null,
  interleavingTolerance: 0.5,
  preferredSessionMinutes: 20,
};

export type UserPreferences = {
  locale: 'ru' | 'en';
  theme: 'system' | 'light' | 'dark';
  /** Показывать тултипы «Почему мы так делаем?» рядом с методиками. */
  showScienceHints: boolean;
  reduceMotion: boolean;
  reviewRemindersEnabled: boolean;
  /** Целевая вероятность вспоминания для FSRS (`request_retention`). */
  requestRetention: number;
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  locale: 'ru',
  theme: 'system',
  showScienceHints: true,
  reduceMotion: false,
  reviewRemindersEnabled: true,
  requestRetention: 0.9,
};

/** Содержимое блока. Дискриминируется `content_blocks.type`. */
export type ContentPayload =
  | { kind: 'prose'; markdown: string; keyPoints?: string[] }
  | { kind: 'assessment_ref'; assessmentIds: string[]; instructions?: string }
  | {
      kind: 'worked_example';
      problem: string;
      steps: { text: string; rationale: string }[];
      solution: string;
    }
  | {
      kind: 'contrast_cases';
      /** 3–5 примеров одного принципа в разных контекстах (вариативность практики). */
      cases: { context: string; example: string; whyItFits: string }[];
      commonPrinciple: string;
    }
  | {
      kind: 'guided_practice';
      task: string;
      /** Подсказки выдаются по одной, затухая от сессии к сессии (fading). */
      hints: string[];
      expectedOutcome: string;
    }
  | { kind: 'reflection_prompt'; questions: string[]; checklist: string[] };

/** Тело вопроса. Дискриминируется `assessments.type`. */
export type AssessmentPayload =
  | { kind: 'mcq'; options: { id: string; text: string }[] }
  | { kind: 'multi_select'; options: { id: string; text: string }[]; minSelect: number }
  | { kind: 'cloze'; template: string; blanks: { id: string; hint?: string }[] }
  | { kind: 'short_answer'; maxLength: number }
  | { kind: 'free_recall'; minItems: number }
  | { kind: 'ordering'; items: { id: string; text: string }[] }
  | { kind: 'matching'; left: { id: string; text: string }[]; right: { id: string; text: string }[] }
  | { kind: 'code'; language: string; starter?: string; tests?: string }
  | { kind: 'case_study'; scenario: string; subQuestions: string[] }
  | { kind: 'estimation'; unit: string; tolerancePct: number };

export type CorrectAnswer =
  | { kind: 'option_ids'; ids: string[] }
  | { kind: 'text'; accepted: string[]; caseSensitive: boolean }
  | { kind: 'blanks'; byBlankId: Record<string, string[]> }
  | { kind: 'order'; ids: string[] }
  | { kind: 'pairs'; byLeftId: Record<string, string> }
  | { kind: 'numeric'; value: number }
  | { kind: 'rubric'; criteria: { id: string; text: string; weight: number }[] };

export type UserResponsePayload =
  | { kind: 'option_ids'; ids: string[] }
  | { kind: 'text'; value: string }
  | { kind: 'blanks'; byBlankId: Record<string, string> }
  | { kind: 'order'; ids: string[] }
  | { kind: 'pairs'; byLeftId: Record<string, string> }
  | { kind: 'numeric'; value: number }
  | { kind: 'code'; source: string };

/** Конфигурация сессии практики, зафиксированная на момент старта. */
export type SessionConfig = {
  mix: boolean;
  /** Доля вопросов из смежных узлов при mix=true. */
  interleaveRatio: number;
  itemCount: number;
  feedbackPolicy: 'auto' | 'force_instant' | 'force_delayed';
  sourceNodeIds: string[];
};

/** Самооценка после модуля. Основа для сравнения «как думал» vs «как есть». */
export type SelfAssessment = {
  perceivedMastery: number; // 1..5
  hardestPart: string;
  plannedNextStep: string;
  checklist: { id: string; label: string; checked: boolean }[];
};

/** Записи в общей «доске» агентов (`user_context`). */
export type AgentFacts = {
  strengths: string[];
  gaps: string[];
  misconceptions: { statement: string; evidenceResponseIds: string[] }[];
  recommendedFocusNodeIds: string[];
  notes: string;
};

export type ProjectRubric = {
  criteria: { id: string; label: string; weight: number; levels: string[] }[];
  /** Вопросы для защиты. Тьютор задаёт их, а не пишет код за пользователя. */
  defenseQuestionSeeds: string[];
};
