import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { scoreReflection } from '@/lib/ai/agents/metacognitive-coach';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import {
  knowledgeNodes,
  learningPaths,
  practiceSessions,
  reflections,
} from '@/lib/db/schema';
import { recomputeNodeProgress } from '@/lib/db/queries/progress';
import { createReflectionSchema } from '@/lib/validation/reflections';

/**
 * Запись рефлексии в дневник — `docs/API.md` §6. Разблокирует переход `mastered`.
 * Сама запись синхронна и не должна ждать LLM-оценку минутами при перегрузке —
 * см. таймаут в `prompts/route.ts`.
 */

const SCORE_TIMEOUT_MS = 8000;

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
    }
    throw error;
  }

  const parsed = createReflectionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' } },
      { status: 400 },
    );
  }
  const { type, nodeId, pathId, sessionId, body, prompts, selfAssessment } = parsed.data;

  if (nodeId) {
    const owned = await db
      .select({ id: knowledgeNodes.id })
      .from(knowledgeNodes)
      .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
      .where(and(eq(knowledgeNodes.id, nodeId), eq(learningPaths.userId, userId)));
    if (!owned[0]) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Узел не найден.' } }, { status: 404 });
    }
  }
  if (pathId) {
    const owned = await db
      .select({ id: learningPaths.id })
      .from(learningPaths)
      .where(and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)));
    if (!owned[0]) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Путь не найден.' } }, { status: 404 });
    }
  }
  if (sessionId) {
    const owned = await db
      .select({ id: practiceSessions.id })
      .from(practiceSessions)
      .where(and(eq(practiceSessions.id, sessionId), eq(practiceSessions.userId, userId)));
    if (!owned[0]) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Сессия не найдена.' } }, { status: 404 });
    }
  }

  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;

  const [row] = await db
    .insert(reflections)
    .values({
      userId,
      pathId: pathId ?? null,
      nodeId: nodeId ?? null,
      sessionId: sessionId ?? null,
      type,
      prompts,
      body,
      selfAssessment: selfAssessment ?? null,
      wordCount,
    })
    .returning({ id: reflections.id });

  if (!row) throw new Error('Не удалось сохранить рефлексию.');

  // Оценка коуча: LLM-вызов, не должен держать ответ пользователю дольше пары секунд.
  try {
    await Promise.race([
      scoreReflection({ userId, reflectionId: row.id }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), SCORE_TIMEOUT_MS)),
    ]);
  } catch {
    // coachFeedback/depthScore останутся null — не критично для основного потока.
  }

  const scored = await db.query.reflections.findFirst({ where: eq(reflections.id, row.id) });

  let unlockedMastery = false;
  if (nodeId && type === 'post_module') {
    const update = await recomputeNodeProgress(userId, nodeId);
    unlockedMastery = update.statusBefore !== 'mastered' && update.statusAfter === 'mastered';
  }

  return NextResponse.json(
    {
      reflectionId: row.id,
      coachFeedback: scored?.coachFeedback ?? null,
      calibrationDelta: scored?.calibrationDelta ?? null,
      unlockedMastery,
    },
    { status: 201 },
  );
}
