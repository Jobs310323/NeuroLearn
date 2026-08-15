import { streamText, stepCountIs, tool, type ModelMessage } from 'ai';
import { z } from 'zod';

import { DEFENSE_COACH_PROMPT, DEFENSE_SCORE_PROMPT } from '../prompts';
import { modelFor } from '../provider';
import { generateValidated } from '../generate';
import { defenseScoreSchema, type DefenseScore } from '../schemas';
import { toolInputSchema } from './tool-schema';

/**
 * Защита проекта — тот же агент-класс, что ведёт `Tutor` (PRD §7), с другим
 * системным промптом и инструментом. `askDefenseQuestion` структурно не
 * имеет поля для кода/решения — модель не может вернуть его через тул, даже
 * если промпт попробуют обойти инъекцией в тексте пользователя.
 */

export type RubricCriterion = { id: string; label: string; weight: number; levels: string[] };

function askDefenseQuestionTool(criteria: RubricCriterion[]) {
  const criterionIds = new Set(criteria.map((c) => c.id));
  return tool({
    description: 'Задать один вопрос по конкретному критерию рубрики защиты проекта.',
    inputSchema: toolInputSchema(
      z.object({
        criterionId: z.string().min(1).max(60),
        question: z.string().min(5).max(600),
      }),
    ),
    execute: async (input) => {
      if (!criterionIds.has(input.criterionId)) {
        return {
          accepted: false,
          reason: `Критерий "${input.criterionId}" не входит в рубрику этого проекта. Доступные: ${[...criterionIds].join(', ')}.`,
        };
      }
      return { accepted: true, criterionId: input.criterionId, question: input.question };
    },
  });
}

export function buildDefenseSystemPrompt(params: {
  projectTitle: string;
  projectBrief: string;
  criteria: RubricCriterion[];
  artifactSummary: string;
}): string {
  return [
    DEFENSE_COACH_PROMPT,
    `\nПроект: «${params.projectTitle}». Бриф: ${params.projectBrief}`,
    `\nРубрика:\n${params.criteria
      .map((c) => `- ${c.id} (вес ${c.weight}): ${c.label}. Уровни: ${c.levels.join(' | ')}`)
      .join('\n')}`,
    `\nАртефакт:\n${params.artifactSummary}`,
  ].join('\n');
}

export function streamDefenseReply(params: {
  system: string;
  messages: ModelMessage[];
  criteria: RubricCriterion[];
}) {
  return streamText({
    model: modelFor('tutor'),
    system: params.system,
    messages: params.messages,
    tools: { askDefenseQuestion: askDefenseQuestionTool(params.criteria) },
    toolChoice: 'required',
    stopWhen: stepCountIs(3),
    temperature: 0.5,
    maxOutputTokens: 900,
  });
}

/** Итоговая оценка защиты по стенограмме — вызывается один раз при завершении. */
export async function scoreDefense(params: {
  userId: string;
  submissionId: string;
  criteria: RubricCriterion[];
  transcript: string;
}): Promise<DefenseScore> {
  const prompt = [
    `Рубрика:\n${params.criteria.map((c) => `- ${c.id} (${c.label}, вес ${c.weight})`).join('\n')}`,
    `\nСтенограмма защиты:\n${params.transcript}`,
  ].join('\n');

  const { data } = await generateValidated({
    agent: 'tutor',
    operation: 'score_defense',
    userId: params.userId,
    system: DEFENSE_SCORE_PROMPT,
    prompt,
    schema: defenseScoreSchema,
    targetTable: 'project_submissions',
    targetId: params.submissionId,
    maxOutputTokens: 2000,
  });

  return data;
}
