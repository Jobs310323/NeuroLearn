import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { generateReflectionPrompts } from '@/lib/ai/agents/metacognitive-coach';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { assessments, knowledgeNodes, learningPaths, userResponses } from '@/lib/db/schema';
import { reflectionPromptsQuerySchema } from '@/lib/validation/reflections';

/**
 * Вопросы дневника от `MetacognitiveCoach` по фактическим данным — `docs/API.md` §6.
 *
 * В отличие от генерации модуля (фоновая задача + опрос статуса), это синхронный
 * запрос: пользователь ждёт его прямо в UI. Бесплатная модель при перегрузке может
 * отвечать минутами — держать соединение открытым столько нельзя, поэтому здесь
 * короткий таймаут с откатом на статичные вопросы вместо ожидания LLM до конца.
 */

const RESPONSE_WINDOW = 20;
const PROMPT_GENERATION_TIMEOUT_MS = 8000;

export async function GET(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
    }
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const parsed = reflectionPromptsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' } },
      { status: 400 },
    );
  }
  const { nodeId, type } = parsed.data;

  const owned = await db
    .select({ id: knowledgeNodes.id })
    .from(knowledgeNodes)
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(and(eq(knowledgeNodes.id, nodeId), eq(learningPaths.userId, userId)));
  if (!owned[0]) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Узел не найден.' } }, { status: 404 });
  }

  const recent = await db
    .select({
      isCorrect: userResponses.isCorrect,
      confidenceLevel: userResponses.confidenceLevel,
      assessmentId: userResponses.assessmentId,
      prompt: assessments.prompt,
    })
    .from(userResponses)
    .innerJoin(assessments, eq(assessments.id, userResponses.assessmentId))
    .where(and(eq(userResponses.userId, userId), eq(userResponses.nodeId, nodeId)))
    .orderBy(desc(userResponses.createdAt))
    .limit(RESPONSE_WINDOW);

  const accuracy = recent.length === 0 ? 0 : recent.filter((r) => r.isCorrect).length / recent.length;
  const withConfidence = recent.filter((r) => r.confidenceLevel != null);
  const calibrationGap =
    withConfidence.length === 0
      ? null
      : withConfidence.reduce((sum, r) => sum + ((r.confidenceLevel as number) - 1) / 4, 0) /
          withConfidence.length -
        accuracy;
  const hardestAssessmentIds = recent
    .filter((r) => !r.isCorrect)
    .slice(0, 5)
    .map((r) => r.assessmentId);

  const wrongPrompts = recent.filter((r) => !r.isCorrect).slice(0, 5);
  const overconfident = recent.filter((r) => !r.isCorrect && (r.confidenceLevel ?? 0) >= 4).length;
  const sessionSummary = [
    `Точность за последние ${recent.length} ответов: ${Math.round(accuracy * 100)}%.`,
    overconfident > 0 ? `Переоценил(а) уверенность в ${overconfident} неверных ответах.` : null,
    wrongPrompts.length > 0
      ? `Ошибся(лась) на: ${wrongPrompts.map((r) => r.prompt).join('; ')}`
      : 'Явных ошибок в последних ответах нет.',
  ]
    .filter(Boolean)
    .join(' ');

  let prompts: string[];
  let checklistLabels: string[];
  try {
    const result = await Promise.race([
      generateReflectionPrompts({ userId, nodeId, sessionSummary }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), PROMPT_GENERATION_TIMEOUT_MS),
      ),
    ]);
    prompts = result.prompts;
    checklistLabels = result.checklist;
  } catch {
    prompts = [
      'Что в этом узле оказалось сложнее, чем ты ожидал(а)?',
      'Какое правило или шаг ты бы объяснил(а) новичку своими словами?',
      'Где ты чаще всего ошибался(лась) и почему, как думаешь?',
    ];
    checklistLabels = [
      'Могу объяснить материал своими словами',
      'Могу применить его без подсказок',
      'Знаю, где применить на практике',
    ];
  }

  return NextResponse.json({
    prompts,
    checklist: checklistLabels.map((label, i) => ({ id: `c${i + 1}`, label })),
    citationKey: 'metacognition',
    context: { accuracy, calibrationGap, hardestAssessmentIds },
  });
}
