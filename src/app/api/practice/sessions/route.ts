import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { assessments, knowledgeNodes, learningPaths, practiceSessions } from '@/lib/db/schema';
import type { SessionConfig } from '@/lib/db/schema/types';
import { decodeDraft } from '@/lib/services/practice/draft';
import { startSessionSchema } from '@/lib/validation/practice';

/** Материализация черновика набора в реальную сессию — `docs/API.md` §3. */

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

  const parsed = startSessionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' } },
      { status: 400 },
    );
  }

  const draft = decodeDraft(parsed.data.sessionDraftId);
  if (!draft) {
    return NextResponse.json(
      { error: { code: 'INVALID_DRAFT', message: 'Черновик набора недействителен или устарел.' } },
      { status: 400 },
    );
  }

  const anchor = await db
    .select({ pathId: knowledgeNodes.pathId })
    .from(knowledgeNodes)
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(and(eq(knowledgeNodes.id, draft.nodeId), eq(learningPaths.userId, userId)));
  const anchorNode = anchor[0];
  if (!anchorNode) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Узел не найден.' } }, { status: 404 });
  }

  const owned = await db
    .select({ id: assessments.id })
    .from(assessments)
    .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, assessments.nodeId))
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(and(inArray(assessments.id, draft.assessmentIds), eq(learningPaths.userId, userId)));
  const ownedIds = new Set(owned.map((row) => row.id));
  const itemOrder = draft.assessmentIds.filter((id) => ownedIds.has(id));

  if (itemOrder.length === 0) {
    return NextResponse.json(
      { error: { code: 'INVALID_DRAFT', message: 'Задания из черновика больше не существуют.' } },
      { status: 409 },
    );
  }

  const config: SessionConfig = {
    mix: draft.mix,
    interleaveRatio: draft.interleaveRatio,
    itemCount: itemOrder.length,
    feedbackPolicy: 'auto',
    sourceNodeIds: draft.sourceNodeIds,
  };

  const [session] = await db
    .insert(practiceSessions)
    .values({
      userId,
      pathId: anchorNode.pathId,
      primaryNodeId: draft.nodeId,
      mode: draft.mode,
      interleaved: draft.mix,
      config,
      itemOrder,
      itemCount: itemOrder.length,
    })
    .returning({ id: practiceSessions.id, startedAt: practiceSessions.startedAt });

  if (!session) throw new Error('Не удалось создать сессию практики.');

  return NextResponse.json(
    { sessionId: session.id, itemOrder, startedAt: session.startedAt.toISOString() },
    { status: 201 },
  );
}
