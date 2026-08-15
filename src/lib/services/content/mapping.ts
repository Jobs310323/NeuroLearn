import type { GeneratedAssessment, ModuleBlocks } from '@/lib/ai/schemas';
import type {
  AssessmentPayload,
  ContentPayload,
  CorrectAnswer,
} from '@/lib/db/schema/types';

/**
 * Преобразование ответа LLM в строки БД.
 *
 * Вынесено отдельно от вызова модели: это чистые функции, они покрыты
 * тестами и не требуют сети.
 */

type BlockType = ModuleBlocks['blocks'][number]['type'];
type GeneratedBlock = ModuleBlocks['blocks'][number];

/** Ключ исследования для тултипа «Почему мы так делаем?» у каждого блока. */
export const BLOCK_CITATION: Record<BlockType, string> = {
  pre_assessment: 'pretesting',
  activation: 'generation_effect',
  concept: 'worked_examples',
  worked_example: 'worked_examples',
  contrast_cases: 'variability_of_practice',
  guided_practice: 'worked_examples',
  independent_practice: 'testing_effect',
  interleaved_practice: 'interleaving',
  transfer_task: 'delayed_feedback',
  reflection: 'metacognition',
};

export function toContentPayload(block: GeneratedBlock): ContentPayload {
  switch (block.type) {
    case 'worked_example':
      return {
        kind: 'worked_example',
        problem: block.body,
        steps: block.steps,
        solution: block.keyPoints.join('\n') || block.body,
      };

    case 'contrast_cases':
      return {
        kind: 'contrast_cases',
        cases: block.cases,
        commonPrinciple: block.keyPoints[0] ?? block.body.slice(0, 300),
      };

    case 'guided_practice':
      return {
        kind: 'guided_practice',
        task: block.body,
        hints: block.hints,
        expectedOutcome: block.keyPoints.join('\n') || 'Задача решена самостоятельно.',
      };

    case 'reflection':
      return {
        kind: 'reflection_prompt',
        questions: block.questions,
        checklist: block.checklist,
      };

    default:
      return { kind: 'prose', markdown: block.body, keyPoints: block.keyPoints };
  }
}

/**
 * Режим обратной связи выводится из глубины обработки, а не задаётся моделью:
 * простое воспроизведение — мгновенно, применение и выше — после завершения
 * набора (Shute, 2008).
 */
export function feedbackModeFor(
  level: GeneratedAssessment['cognitiveLevel'],
): 'instant' | 'delayed' {
  return level === 'recall' || level === 'understand' ? 'instant' : 'delayed';
}

export function toAssessmentPayload(assessment: GeneratedAssessment): AssessmentPayload {
  switch (assessment.type) {
    case 'mcq':
      return { kind: 'mcq', options: assessment.options ?? [] };
    case 'multi_select':
      return {
        kind: 'multi_select',
        options: assessment.options ?? [],
        minSelect: Math.max(1, assessment.correctOptionIds?.length ?? 1),
      };
    case 'cloze':
      return { kind: 'cloze', template: assessment.prompt, blanks: [{ id: 'b1' }] };
    case 'short_answer':
      return { kind: 'short_answer', maxLength: 400 };
    case 'free_recall':
      return { kind: 'free_recall', minItems: 3 };
    case 'case_study':
      return { kind: 'case_study', scenario: assessment.prompt, subQuestions: [] };
  }
}

export function toCorrectAnswer(assessment: GeneratedAssessment): CorrectAnswer {
  if (assessment.type === 'mcq' || assessment.type === 'multi_select') {
    return { kind: 'option_ids', ids: assessment.correctOptionIds ?? [] };
  }
  if (assessment.type === 'cloze') {
    return { kind: 'blanks', byBlankId: { b1: assessment.acceptedAnswers ?? [] } };
  }
  return {
    kind: 'text',
    accepted: assessment.acceptedAnswers ?? [],
    caseSensitive: false,
  };
}

/**
 * Стабильный идентификатор группы вариативности внутри узла.
 * Модель присылает человекочитаемый ключ, в БД нужен UUID.
 */
export function variantGroupIds(assessments: GeneratedAssessment[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const assessment of assessments) {
    if (!ids.has(assessment.variantGroup)) {
      ids.set(assessment.variantGroup, crypto.randomUUID());
    }
  }
  return ids;
}
