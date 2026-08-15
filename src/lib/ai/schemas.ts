import { z } from 'zod';

/**
 * Контракты структурированного вывода LLM.
 *
 * Ничто из ответа модели не попадает в БД, не пройдя эти схемы. Провал
 * валидации фиксируется в `ai_generations.status = 'schema_failed'`,
 * даётся одна повторная попытка с текстом ошибки, затем отказ.
 */

// --- Дерево знаний ---------------------------------------------------------

export const generatedNodeSchema = z.object({
  /** Временный ключ внутри ответа: связи ссылаются на него, а не на UUID. */
  key: z
    .string()
    .regex(/^[a-z0-9-]{2,40}$/, 'ключ: строчные латинские буквы, цифры и дефис'),
  parentKey: z.string().nullable(),
  title: z.string().min(2).max(200),
  description: z.string().min(10).max(600),
  /** Важность для цели пути. */
  weight: z.number().min(0).max(1),
  difficulty: z.number().min(0).max(1),
  estimatedMinutes: z.number().int().min(5).max(240),
});

export const generatedEdgeSchema = z.object({
  sourceKey: z.string(),
  targetKey: z.string(),
  relation: z.enum(['prerequisite', 'related', 'contrast', 'analogous']),
  strength: z.number().min(0).max(1),
});

export const treeGenerationSchema = z
  .object({
    nodes: z.array(generatedNodeSchema).min(4).max(60),
    edges: z.array(generatedEdgeSchema).max(200),
  })
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    for (const node of value.nodes) {
      if (keys.has(node.key)) {
        ctx.addIssue({ code: 'custom', message: `дубликат ключа узла: ${node.key}` });
      }
      keys.add(node.key);
    }

    for (const node of value.nodes) {
      if (node.parentKey !== null && !keys.has(node.parentKey)) {
        ctx.addIssue({
          code: 'custom',
          message: `узел ${node.key} ссылается на несуществующего родителя ${node.parentKey}`,
        });
      }
      if (node.parentKey === node.key) {
        ctx.addIssue({ code: 'custom', message: `узел ${node.key} — родитель самому себе` });
      }
    }

    for (const edge of value.edges) {
      if (!keys.has(edge.sourceKey) || !keys.has(edge.targetKey)) {
        ctx.addIssue({
          code: 'custom',
          message: `связь ${edge.sourceKey} → ${edge.targetKey} ссылается на неизвестный узел`,
        });
      }
      if (edge.sourceKey === edge.targetKey) {
        ctx.addIssue({ code: 'custom', message: `петля на узле ${edge.sourceKey}` });
      }
    }

    if (value.nodes.filter((n) => n.parentKey === null).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'нет корневого узла' });
    }
  });

export type TreeGeneration = z.infer<typeof treeGenerationSchema>;

// --- Задания ---------------------------------------------------------------

const optionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,12}$/),
  text: z.string().min(1).max(400),
});

export const generatedAssessmentSchema = z.object({
  type: z.enum(['mcq', 'multi_select', 'cloze', 'short_answer', 'free_recall', 'case_study']),
  cognitiveLevel: z.enum(['recall', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  prompt: z.string().min(10).max(1200),
  options: z.array(optionSchema).max(6).optional(),
  /** Идентификаторы верных вариантов либо принимаемые текстовые ответы. */
  correctOptionIds: z.array(z.string()).max(6).optional(),
  acceptedAnswers: z.array(z.string().min(1).max(300)).max(8).optional(),
  explanation: z.string().min(10).max(1200),
  /** Наводящие вопросы для ошибки. Готовый ответ здесь запрещён. */
  socraticHints: z.array(z.string().min(5).max(300)).min(1).max(4),
  /** Группа вариативности: одинаковый навык в разных контекстах. */
  variantGroup: z.string().regex(/^[a-z0-9-]{2,40}$/),
  contextLabel: z.string().min(2).max(80),
  isPreAssessment: z.boolean(),
  targetResponseSeconds: z.number().int().min(5).max(600),
});

export type GeneratedAssessment = z.infer<typeof generatedAssessmentSchema>;

// --- Модуль из 10 блоков ---------------------------------------------------

export const CANONICAL_BLOCK_ORDER = [
  'pre_assessment',
  'activation',
  'concept',
  'worked_example',
  'contrast_cases',
  'guided_practice',
  'independent_practice',
  'interleaved_practice',
  'transfer_task',
  'reflection',
] as const;

export const generatedBlockSchema = z.object({
  type: z.enum(CANONICAL_BLOCK_ORDER),
  title: z.string().min(2).max(160),
  /**
   * Основной текст блока в Markdown. Для блоков-практик — инструкция.
   * Потолок низкий намеренно: приложение строит навык практикой, длинная
   * теория ей мешает, а десять длинных блоков не влезают в лимит вывода.
   */
  body: z.string().min(20).max(3000),
  /** Ключевые тезисы. Для `concept` обязательны. */
  keyPoints: z.array(z.string().min(3).max(300)).max(7).default([]),
  /** Для `worked_example`: шаги с обоснованием. */
  steps: z
    .array(z.object({ text: z.string().min(3).max(600), rationale: z.string().min(3).max(600) }))
    .max(10)
    .default([]),
  /** Для `contrast_cases`: 3–5 контекстов одного принципа. */
  cases: z
    .array(
      z.object({
        context: z.string().min(2).max(120),
        example: z.string().min(5).max(800),
        whyItFits: z.string().min(5).max(600),
      }),
    )
    .max(5)
    .default([]),
  /** Для `guided_practice`: подсказки, выдаются по одной и затухают. */
  hints: z.array(z.string().min(3).max(400)).max(5).default([]),
  /** Для `reflection`: вопросы дневника и чек-лист самооценки. */
  questions: z.array(z.string().min(5).max(400)).max(6).default([]),
  checklist: z.array(z.string().min(3).max(200)).max(8).default([]),
});

/**
 * Блоки и задания генерируются РАЗНЫМИ вызовами модели.
 *
 * Один вызов на 10 блоков плюс банк заданий бесплатная модель не вытягивает:
 * ответ либо не проходит схему, либо не укладывается в лимит времени функции.
 * Два вызова короче каждый по отдельности и проваливаются по отдельности.
 */
export const moduleBlocksSchema = z
  .object({
    blocks: z.array(generatedBlockSchema).length(10),
  })
  .superRefine((value, ctx) => {
    // Требуется полный комплект типов, по одному каждого. Порядок в ответе
    // не проверяется: канонический порядок задаётся при записи в БД, а не
    // доверяется модели — она сбивается на нём, хотя содержание блоков верное.
    const seen = new Set<string>();
    for (const block of value.blocks) {
      if (seen.has(block.type)) {
        ctx.addIssue({ code: 'custom', message: `блок ${block.type} встречается дважды` });
      }
      seen.add(block.type);
    }
    for (const type of CANONICAL_BLOCK_ORDER) {
      if (!seen.has(type)) {
        ctx.addIssue({ code: 'custom', message: `отсутствует блок ${type}` });
      }
    }

    const contrastCases = value.blocks.find((b) => b.type === 'contrast_cases');
    if (contrastCases && contrastCases.cases.length < 3) {
      ctx.addIssue({
        code: 'custom',
        message: 'блок contrast_cases требует минимум 3 контекста (вариативность практики)',
      });
    }

    const reflection = value.blocks.find((b) => b.type === 'reflection');
    if (reflection && reflection.questions.length < 3) {
      ctx.addIssue({ code: 'custom', message: 'блок reflection требует минимум 3 вопроса' });
    }
  });

export type ModuleBlocks = z.infer<typeof moduleBlocksSchema>;

/**
 * Половина комплекта блоков — 5 из 10. Один вызов на все 10 регулярно не
 * укладывался в терпение апстрима бесплатной модели (~120с): вдвое меньше
 * блоков на вызов — вдвое меньше токенов и времени.
 */
export const BLOCK_GROUP_A = CANONICAL_BLOCK_ORDER.slice(0, 5);
export const BLOCK_GROUP_B = CANONICAL_BLOCK_ORDER.slice(5);

export function moduleBlockGroupSchema(allowedTypes: readonly string[]) {
  return z
    .object({ blocks: z.array(generatedBlockSchema).length(allowedTypes.length) })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      for (const block of value.blocks) {
        if (!allowedTypes.includes(block.type)) {
          ctx.addIssue({ code: 'custom', message: `блок ${block.type} не входит в эту группу` });
        }
        if (seen.has(block.type)) {
          ctx.addIssue({ code: 'custom', message: `блок ${block.type} встречается дважды` });
        }
        seen.add(block.type);
      }
      for (const type of allowedTypes) {
        if (!seen.has(type)) {
          ctx.addIssue({ code: 'custom', message: `отсутствует блок ${type}` });
        }
      }

      const contrastCases = value.blocks.find((b) => b.type === 'contrast_cases');
      if (contrastCases && contrastCases.cases.length < 3) {
        ctx.addIssue({
          code: 'custom',
          message: 'блок contrast_cases требует минимум 3 контекста (вариативность практики)',
        });
      }

      const reflection = value.blocks.find((b) => b.type === 'reflection');
      if (reflection && reflection.questions.length < 3) {
        ctx.addIssue({ code: 'custom', message: 'блок reflection требует минимум 3 вопроса' });
      }
    });
}

export const moduleAssessmentsSchema = z
  .object({
    assessments: z.array(generatedAssessmentSchema).min(6).max(16),
  })
  .superRefine((value, ctx) => {
    const preAssessments = value.assessments.filter((a) => a.isPreAssessment);
    if (preAssessments.length < 3) {
      ctx.addIssue({
        code: 'custom',
        message: 'нужно минимум 3 задания с isPreAssessment=true (тема начинается с теста)',
      });
    }

    const deep = value.assessments.filter((a) =>
      ['apply', 'analyze', 'evaluate', 'create'].includes(a.cognitiveLevel),
    );
    if (deep.length < 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'нужно минимум 2 задания уровня apply и выше (для отложенной обратной связи)',
      });
    }

    const groups = new Map<string, Set<string>>();
    for (const assessment of value.assessments) {
      const contexts = groups.get(assessment.variantGroup) ?? new Set<string>();
      contexts.add(assessment.contextLabel);
      groups.set(assessment.variantGroup, contexts);
    }
    for (const [group, contexts] of groups) {
      if (contexts.size === 1 && (groups.get(group)?.size ?? 0) > 0) {
        const size = value.assessments.filter((a) => a.variantGroup === group).length;
        if (size > 1) {
          ctx.addIssue({
            code: 'custom',
            message: `группа вариантов ${group}: все задания в одном контексте`,
          });
        }
      }
    }

    for (const assessment of value.assessments) {
      const needsOptions = assessment.type === 'mcq' || assessment.type === 'multi_select';
      if (needsOptions) {
        if (!assessment.options || assessment.options.length < 2) {
          ctx.addIssue({
            code: 'custom',
            message: `задание типа ${assessment.type} требует минимум 2 варианта`,
          });
          continue;
        }
        const ids = new Set(assessment.options.map((o) => o.id));
        const correct = assessment.correctOptionIds ?? [];
        if (correct.length === 0) {
          ctx.addIssue({ code: 'custom', message: 'не указан верный вариант' });
        }
        for (const id of correct) {
          if (!ids.has(id)) {
            ctx.addIssue({ code: 'custom', message: `верный вариант ${id} отсутствует в списке` });
          }
        }
        if (assessment.type === 'mcq' && correct.length !== 1) {
          ctx.addIssue({ code: 'custom', message: 'mcq требует ровно один верный вариант' });
        }
      } else if (!assessment.acceptedAnswers || assessment.acceptedAnswers.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: `задание типа ${assessment.type} требует acceptedAnswers`,
        });
      }
    }
  });

export type ModuleAssessments = z.infer<typeof moduleAssessmentsSchema>;

// --- Анализ прогресса ------------------------------------------------------

export const progressAnalysisSchema = z.object({
  strengths: z.array(z.string().min(3).max(200)).max(6),
  gaps: z.array(z.string().min(3).max(200)).max(6),
  misconceptions: z
    .array(
      z.object({
        statement: z.string().min(5).max(300),
        evidence: z.string().min(5).max(300),
      }),
    )
    .max(5),
  recommendedFocus: z.array(z.string().min(2).max(200)).max(5),
  summary: z.string().min(20).max(1200),
});

export type ProgressAnalysis = z.infer<typeof progressAnalysisSchema>;

export const reflectionPromptsSchema = z.object({
  prompts: z.array(z.string().min(10).max(400)).min(3).max(5),
  checklist: z.array(z.string().min(3).max(200)).min(3).max(8),
});

export type ReflectionPrompts = z.infer<typeof reflectionPromptsSchema>;

export const reflectionScoreSchema = z.object({
  depthScore: z.number().min(0).max(1),
  coachFeedback: z.string().min(20).max(600),
});

export type ReflectionScore = z.infer<typeof reflectionScoreSchema>;

// --- Защита проекта ---------------------------------------------------------

export const defenseScoreSchema = z.object({
  rubricScores: z
    .array(
      z.object({
        criterionId: z.string().min(1).max(60),
        score: z.number().min(0).max(1),
        rationale: z.string().min(5).max(400),
      }),
    )
    .min(1),
  summary: z.string().min(10).max(800),
});

export type DefenseScore = z.infer<typeof defenseScoreSchema>;
