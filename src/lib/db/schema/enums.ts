import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Жизненный цикл узла знаний.
 * `automated` — уровень бессознательной компетенции: высокая точность
 * при низком времени реакции на нескольких разнесённых во времени сессиях.
 */
export const nodeStatusEnum = pgEnum('node_status', [
  'not_started',
  'in_progress',
  'mastered',
  'needs_review',
  'has_gaps',
  'automated',
]);

export const pathStatusEnum = pgEnum('path_status', [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
]);

/**
 * Каноническая последовательность из 10 блоков модуля.
 * Порядок значим: тест идёт ДО теории (Roediger & Karpicke, 2006;
 * Richland, Kornell & Kao, 2009 — pretesting / errorful generation).
 */
export const contentBlockTypeEnum = pgEnum('content_block_type', [
  'pre_assessment', // 1. тест до теории
  'activation', // 2. активация прошлых знаний
  'concept', // 3. минимальное ядро теории
  'worked_example', // 4. разобранный пример (Sweller, worked-example effect)
  'contrast_cases', // 5. вариативность контекстов / контрастные случаи
  'guided_practice', // 6. практика с затухающими подсказками (fading)
  'independent_practice', // 7. самостоятельная практика, instant feedback
  'interleaved_practice', // 8. перемешанная практика со смежными узлами
  'transfer_task', // 9. перенос в новый контекст, delayed feedback
  'reflection', // 10. метакогнитивный дневник (Flavell, 1979)
]);

export const assessmentTypeEnum = pgEnum('assessment_type', [
  'mcq',
  'multi_select',
  'cloze',
  'short_answer',
  'free_recall',
  'ordering',
  'matching',
  'code',
  'case_study',
  'estimation',
]);

/** Иерархия глубины обработки (Bloom / Anderson & Krathwohl, 2001). */
export const cognitiveLevelEnum = pgEnum('cognitive_level', [
  'recall',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
]);

/**
 * Shute (2008), Focus on Formative Feedback:
 * простое воспроизведение фактов -> instant, сложные задачи -> delayed.
 */
export const feedbackModeEnum = pgEnum('feedback_mode', ['instant', 'delayed']);

/** Совпадает по семантике с `State` из ts-fsrs (New/Learning/Review/Relearning). */
export const fsrsStateEnum = pgEnum('fsrs_state', [
  'new',
  'learning',
  'review',
  'relearning',
]);

/** Совпадает по семантике с `Rating` из ts-fsrs (Again/Hard/Good/Easy). */
export const fsrsRatingEnum = pgEnum('fsrs_rating', ['again', 'hard', 'good', 'easy']);

/**
 * Рёбра графа знаний поверх дерева (parent_id).
 * `related` и `contrast` питают интерливинг (Rohrer, 2012).
 */
export const nodeRelationEnum = pgEnum('node_relation', [
  'prerequisite',
  'related',
  'contrast',
  'analogous',
]);

export const practiceModeEnum = pgEnum('practice_mode', [
  'pre_assessment',
  'focused',
  'interleaved',
  'review',
  'exam',
  'remediation',
]);

export const reflectionTypeEnum = pgEnum('reflection_type', [
  'pre_flight',
  'post_module',
  'error_analysis',
  'weekly',
  'project_defense',
]);

/**
 * Тип ошибки в ответе. Различение нужно не для статистики, а для выбора
 * следующего шага: разные ошибки лечатся разным материалом.
 *
 * `factual_slip` — знает правило, промахнулся в факте;
 * `conceptual` — держит неверную модель, ошибка воспроизводится;
 * `transfer_failure` — знает в исходном контексте, не переносит в новый;
 * `careless` — знает и умеет, ошибся по невнимательности (быстро и уверенно).
 */
export const errorKindEnum = pgEnum('error_kind', [
  'factual_slip',
  'conceptual',
  'transfer_failure',
  'careless',
]);

export const agentKindEnum = pgEnum('agent_kind', [
  'content_generator',
  'tutor',
  'progress_analyzer',
  'metacognitive_coach',
]);

export const contextScopeEnum = pgEnum('context_scope', ['global', 'path', 'node']);

export const messageRoleEnum = pgEnum('message_role', [
  'user',
  'assistant',
  'system',
  'tool',
]);

export const submissionStatusEnum = pgEnum('submission_status', [
  'draft',
  'submitted',
  'in_defense',
  'revisions_requested',
  'accepted',
]);

export const generationStatusEnum = pgEnum('generation_status', [
  'pending',
  'succeeded',
  'schema_failed',
  'provider_failed',
]);
