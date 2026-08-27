import { isOverconfidentMiss } from '@/lib/services/learner/calibration';

import { HINT_THRESHOLDS, bloomDifficulty } from './config';
import type { HintContext, HintResponseSample, HintRule } from './types';

/**
 * Шесть правил первой версии.
 *
 * Общее для всех: правило смотрит ТОЛЬКО на телеметрию текущей сессии и на
 * уже валидированные сигналы (разрыв калибровки, граф связей, таксономия
 * ошибок). Долгосрочные индексы — в частности индекс усталости из
 * `services/practice/fatigue.ts` — сюда не входят: они остаются наблюдением
 * в аналитике, пока не подтвердятся на собственных данных. Правило отдыха
 * пользуется внутрисессионной скользящей медианой, а не этим индексом, — так
 * подсказка работает уже сейчас и дисциплина сигналов не нарушена.
 */

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function lastResponse(context: HintContext): HintResponseSample | null {
  return context.responses[context.currentIndex] ?? null;
}

/**
 * 1. Предложение перерыва.
 *
 * Замедление считается по верным ответам: время неверного — это время
 * колебаний и пересмотра решения, а не темп извлечения из памяти (та же
 * причина, по которой так считает `fatigue.ts`).
 *
 * Таймер запускает человек. Система не решает за него, что пора отдыхать, —
 * она сообщает наблюдение и предлагает.
 */
const restSuggestion: HintRule = {
  id: 'rest_suggestion',
  priority: 60,
  cooldownItems: Number.POSITIVE_INFINITY,
  maxPerSession: 1,
  evaluate: (context) => {
    const { baselineItems, minItems, windowItems, slowdownRatio, restSeconds } =
      HINT_THRESHOLDS.rest;

    const answered = context.responses.slice(0, context.currentIndex + 1);
    if (answered.length < minItems) return null;

    const correct = answered.filter((r) => r.isCorrect);
    if (correct.length < baselineItems + 2) return null;

    const baseline = median(correct.slice(0, baselineItems).map((r) => r.responseTimeMs));
    const recent = median(correct.slice(-windowItems).map((r) => r.responseTimeMs));
    if (baseline === null || recent === null || baseline === 0) return null;

    const growth = (recent - baseline) / baseline;
    if (growth <= slowdownRatio) return null;

    return {
      messageKey: 'hints.rest.message',
      values: { percent: Math.round(growth * 100), minutes: Math.round(restSeconds / 60) },
      reasonKey: 'hints.rest.reason',
      action: { kind: 'start_rest_timer', seconds: restSeconds },
    };
  },
};

/**
 * 2. Метакогнитивный коучинг.
 *
 * Триггер тот же, что у разрыва калибровки в отчёте о сессии
 * (`services/learner/calibration.ts`) — логика не дублируется, иначе
 * «переоценка себя» в двух местах разъехалась бы на первом уточнении порога.
 */
const metacognitiveCoaching: HintRule = {
  id: 'metacognitive_coaching',
  priority: 80,
  cooldownItems: 3,
  maxPerSession: 2,
  evaluate: (context) => {
    const last = lastResponse(context);
    if (!last) return null;
    if (!isOverconfidentMiss(last, HINT_THRESHOLDS.metacognition.minConfidence)) return null;

    return {
      messageKey: 'hints.metacognition.message',
      values: { confidence: last.confidenceLevel ?? 0 },
      reasonKey: 'hints.metacognition.reason',
      action: { kind: 'open_tutor', nodeId: last.nodeId, assessmentId: last.assessmentId },
    };
  },
};

/**
 * 3. Предложение контрастного сравнения.
 *
 * Две ошибки в окне из пяти заданий по одному узлу или его соседям
 * (related/contrast, BFS-1) — это уже не случайность, а устойчивое смешение
 * двух близких понятий. Лечится оно не повторением теории, а контрастными
 * случаями: двумя примерами с выделенным критическим различием.
 */
const contrastModeOffer: HintRule = {
  id: 'contrast_mode_offer',
  priority: 70,
  cooldownItems: 5,
  maxPerSession: 2,
  evaluate: (context) => {
    const last = lastResponse(context);
    if (!last || last.isCorrect) return null;

    const { minErrors, windowItems } = HINT_THRESHOLDS.contrast;
    const window = context.responses.slice(
      Math.max(0, context.currentIndex - windowItems + 1),
      context.currentIndex + 1,
    );

    const related = new Set([last.nodeId, ...(context.neighbours[last.nodeId] ?? [])]);
    const errors = window.filter((r) => !r.isCorrect && related.has(r.nodeId));
    if (errors.length < minErrors) return null;

    // Careless-ошибки материалом не лечатся: человек знает и умеет, промах в
    // невнимательности. Предлагать ему контрастные случаи — терять его время.
    if (errors.every((r) => r.errorKind === 'careless')) return null;

    return {
      messageKey: 'hints.contrast.message',
      values: { errors: errors.length, window: window.length },
      reasonKey: 'hints.contrast.reason',
      action: { kind: 'open_contrast', nodeId: last.nodeId },
    };
  },
};

/**
 * 4. Чип сложности.
 *
 * Постоянный индикатор уровня по Блуму, а на уровне 4+ — однократное
 * сообщение, что можно запросить наводящую подсказку. Наводящую, не ответ:
 * банк заданий хранит сократические подсказки, и подсказка на этом уровне —
 * способ не бросить задачу, а не способ её обойти.
 */
const difficultyIndicator: HintRule = {
  id: 'difficulty_indicator',
  priority: 20,
  cooldownItems: Number.POSITIVE_INFINITY,
  maxPerSession: 1,
  evaluate: (context) => {
    const level = bloomDifficulty(context.nextCognitiveLevel);
    if (level === null || level < HINT_THRESHOLDS.difficulty.offerHintFromLevel) return null;

    return {
      messageKey: 'hints.difficulty.message',
      values: { level },
      reasonKey: 'hints.difficulty.reason',
      action: { kind: 'request_hint' },
    };
  },
};

/**
 * 5. Приглашение записать мысль.
 *
 * Срабатывает на флаге «не понял» и на провале задания переноса. Оба случая
 * означают одно: у человека сейчас есть сформулированное непонимание, и
 * через три задания оно исчезнет. Заметка с автоякорем — единственный способ
 * его сохранить; она же попадёт в реестр непонимания и в недельный разбор.
 */
const captureNudge: HintRule = {
  id: 'capture_nudge',
  priority: 75,
  cooldownItems: 2,
  maxPerSession: 3,
  evaluate: (context) => {
    const last = lastResponse(context);
    if (!last) return null;

    const failedTransfer = !last.isCorrect && last.blockType === 'transfer_task';
    if (!last.flaggedConfusion && !failedTransfer) return null;

    return {
      messageKey: last.flaggedConfusion
        ? 'hints.capture.confusion'
        : 'hints.capture.transfer',
      values: {},
      reasonKey: 'hints.capture.reason',
      action: {
        kind: 'capture_note',
        nodeId: last.nodeId,
        assessmentId: last.assessmentId,
        confusion: last.flaggedConfusion,
      },
    };
  },
};

/**
 * 6. «Перечитать перед практикой».
 *
 * Показывается ДО первого задания (`currentIndex === -1`) и только если у
 * узлов сессии есть живые заметки, которым пора вернуться. Максимум две:
 * больше — это уже чтение вместо практики, а практика здесь главная.
 */
const reviewBeforeSession: HintRule = {
  id: 'review_before_session',
  priority: 90,
  cooldownItems: Number.POSITIVE_INFINITY,
  maxPerSession: 1,
  evaluate: (context) => {
    if (context.currentIndex !== -1) return null;
    if (context.dueNotes.length === 0) return null;

    const notes = context.dueNotes.slice(0, HINT_THRESHOLDS.review.maxNotes);
    const first = notes[0]!;

    return {
      messageKey: 'hints.review.message',
      values: { count: notes.length, title: first.title },
      reasonKey: 'hints.review.reason',
      action: { kind: 'open_note', noteId: first.noteId },
    };
  },
};

/** Порядок в массиве не значим — движок сортирует по приоритету. */
export const HINT_RULES: HintRule[] = [
  restSuggestion,
  metacognitiveCoaching,
  contrastModeOffer,
  difficultyIndicator,
  captureNudge,
  reviewBeforeSession,
];

export const HINT_RULE_BY_ID = new Map(HINT_RULES.map((rule) => [rule.id, rule]));
