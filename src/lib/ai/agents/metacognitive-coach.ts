import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { reflections, userResponses } from '@/lib/db/schema';

import { generateValidated } from '../generate';
import { METACOGNITIVE_COACH_PROMPT, METACOGNITIVE_COACH_SCORE_PROMPT } from '../prompts';
import { reflectionPromptsSchema, reflectionScoreSchema } from '../schemas';

/**
 * MetacognitiveCoach: вопросы дневника ДО того, как человек пишет рефлексию,
 * и оценка написанного ПОСЛЕ — не как оценка личности, а как разрыв
 * калибровки (Flavell, 1979): `perceivedMastery` из selfAssessment против
 * фактической точности по тем же ответам.
 */

export async function generateReflectionPrompts(params: {
  userId: string;
  nodeId: string;
  /** Короткое описание сессии: что было неверно, что заняло много времени, где разошлась уверенность. */
  sessionSummary: string;
}): Promise<{ prompts: string[]; checklist: string[] }> {
  const { data } = await generateValidated({
    agent: 'metacognitive_coach',
    operation: 'generate_reflection_prompts',
    userId: params.userId,
    system: METACOGNITIVE_COACH_PROMPT,
    prompt: `Данные сессии по узлу:\n${params.sessionSummary}`,
    schema: reflectionPromptsSchema,
    targetTable: 'knowledge_nodes',
    targetId: params.nodeId,
    maxOutputTokens: 1200,
  });

  return data;
}

/**
 * Оценивает уже сохранённую рефлексию: пишет `depthScore`, `coachFeedback`
 * и `calibrationDelta` прямо в строку `reflections`. Вызывается после того,
 * как пользователь отправил текст (запись создаёт Server Action — здесь
 * только LLM-часть и подсчёт калибровки).
 */
export async function scoreReflection(params: {
  userId: string;
  reflectionId: string;
}): Promise<void> {
  const reflection = await db.query.reflections.findFirst({
    where: eq(reflections.id, params.reflectionId),
  });
  if (!reflection || reflection.userId !== params.userId) {
    throw new Error('Рефлексия не найдена');
  }

  const accuracy = await actualAccuracyFor(reflection.userId, reflection.sessionId, reflection.nodeId);
  const calibrationDelta =
    accuracy !== null && reflection.selfAssessment
      ? normalizePerceivedMastery(reflection.selfAssessment.perceivedMastery) - accuracy
      : null;

  const { data } = await generateValidated({
    agent: 'metacognitive_coach',
    operation: 'score_reflection',
    userId: params.userId,
    system: METACOGNITIVE_COACH_SCORE_PROMPT,
    prompt: buildScoringPrompt(reflection.body, calibrationDelta),
    schema: reflectionScoreSchema,
    targetTable: 'reflections',
    targetId: reflection.id,
    maxOutputTokens: 800,
  });

  await db
    .update(reflections)
    .set({
      depthScore: data.depthScore,
      coachFeedback: data.coachFeedback,
      calibrationDelta,
      updatedAt: new Date(),
    })
    .where(eq(reflections.id, reflection.id));
}

function normalizePerceivedMastery(value: number): number {
  return (value - 1) / 4;
}

async function actualAccuracyFor(
  userId: string,
  sessionId: string | null,
  nodeId: string | null,
): Promise<number | null> {
  const conditions = [eq(userResponses.userId, userId)];
  if (sessionId) conditions.push(eq(userResponses.sessionId, sessionId));
  else if (nodeId) conditions.push(eq(userResponses.nodeId, nodeId));
  else return null;

  const rows = await db
    .select({ isCorrect: userResponses.isCorrect, partialScore: userResponses.partialScore })
    .from(userResponses)
    .where(and(...conditions));

  if (rows.length === 0) return null;
  return rows.reduce((sum, r) => sum + (r.isCorrect ? 1 : r.partialScore), 0) / rows.length;
}

function buildScoringPrompt(body: string, calibrationDelta: number | null): string {
  return [
    'Оцени глубину рефлексии ниже.',
    calibrationDelta !== null
      ? `Разрыв калибровки: ${calibrationDelta >= 0 ? '+' : ''}${calibrationDelta.toFixed(2)} (положительное значение — переоценка себя).`
      : 'Данных для расчёта калибровки недостаточно.',
    `Текст рефлексии:\n${body}`,
  ].join('\n\n');
}
