import type { nodeStatusEnum } from '@/lib/db/schema/enums';

/**
 * Переходы статуса узла — таблица из `PRD.md` §5. Чистая функция: вся
 * телеметрия собирается заранее (`progress.ts`), здесь только правило.
 */

export type NodeStatus = (typeof nodeStatusEnum.enumValues)[number];

/** Сколько разных дней должно набраться среди верных-и-быстрых ответов для перехода в `automated` (PRD §3 п.10). */
const MIN_AUTOMATICITY_DAYS = 3;

export type TransitionFacts = {
  hasAnyResponse: boolean;
  hasPreAssessmentResponse: boolean;
  responseCount: number;
  accuracy: number;
  knowledgeStrength: number;
  hasPostModuleReflection: boolean;
  distinctPracticeDays: number;
  automaticityIndex: number;
  /**
   * F11: автоматизм через дисперсию, не только через порог скорости.
   * `automaticityIndex` — доля верных-и-быстрых ответов, но не различает
   * ровный темп («знаю и отвечаю стабильно быстро») от рваного («иногда
   * очень быстро, иногда еле укладываюсь в порог» — то же среднее, разная
   * природа). `false`, пока не набралось достаточно наблюдений для
   * коэффициента вариации: отсутствие доказательства устойчивости не
   * приравнивается к устойчивости, тем же принципом, что и
   * `interleavedAccuracy` ниже.
   */
  responseTimeConsistent: boolean;
  /**
   * PRD §3 п.10: автоматизм подтверждается на нескольких занятиях в РАЗНЫЕ
   * дни, не одной ударной сессией. Число дней среди верных-и-быстрых
   * ответов в окне — три подряд удачных ответа в одной сессии проходили бы
   * иначе тот же порог `automaticityIndex`, но это одна попытка, а не
   * устойчивость во времени.
   */
  automaticityDistinctDays: number;
  successfulLongReviews: number;
  interleavedAccuracy: number | null;
  cardDuePast: boolean;
  hasGapFromProjectDefense: boolean;
};

export function nextNodeStatus(current: NodeStatus, facts: TransitionFacts): NodeStatus {
  if (current === 'not_started') {
    if (facts.hasPreAssessmentResponse) return 'in_progress';
    return current;
  }

  if (current === 'in_progress') {
    if (facts.responseCount >= 6 && facts.accuracy < 0.5) return 'has_gaps';
    if (
      facts.knowledgeStrength >= 80 &&
      facts.hasPostModuleReflection &&
      facts.distinctPracticeDays >= 2
    ) {
      return 'mastered';
    }
    return current;
  }

  if (current === 'has_gaps') {
    if (
      facts.knowledgeStrength >= 80 &&
      facts.hasPostModuleReflection &&
      facts.distinctPracticeDays >= 2
    ) {
      return 'mastered';
    }
    return current;
  }

  if (current === 'mastered') {
    if (facts.hasGapFromProjectDefense) return 'has_gaps';
    if (
      facts.automaticityIndex >= 0.8 &&
      facts.responseTimeConsistent &&
      facts.automaticityDistinctDays >= MIN_AUTOMATICITY_DAYS &&
      facts.successfulLongReviews >= 3 &&
      (facts.interleavedAccuracy ?? 0) >= 0.9
    ) {
      return 'automated';
    }
    if (facts.cardDuePast) return 'needs_review';
    return current;
  }

  if (current === 'automated') {
    if (facts.hasGapFromProjectDefense) return 'has_gaps';
    if (facts.cardDuePast) return 'needs_review';
    return current;
  }

  if (current === 'needs_review') {
    // Возврат к обычному статусу решает следующее успешное повторение —
    // как только due снова в будущем, узел больше не «просрочен».
    if (!facts.cardDuePast) {
      if (
        facts.automaticityIndex >= 0.8 &&
        facts.responseTimeConsistent &&
        facts.automaticityDistinctDays >= MIN_AUTOMATICITY_DAYS &&
        facts.successfulLongReviews >= 3 &&
        (facts.interleavedAccuracy ?? 0) >= 0.9
      ) {
        return 'automated';
      }
      return 'mastered';
    }
    return current;
  }

  return current;
}
