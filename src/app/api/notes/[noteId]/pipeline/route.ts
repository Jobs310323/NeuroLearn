import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { learningExperiments, notes, tutorConversations } from '@/lib/db/schema';
import {
  draftExperimentFromIdea,
  seedTutorFromQuestion,
} from '@/lib/services/notes/pipelines';

/**
 * Пайплайны «мысль → действие».
 *
 * `to_experiment` — идея становится черновиком N-of-1 эксперимента. Именно
 * черновиком (`status: 'draft'`): запуск эксперимента меняет подбор практики
 * на неделю вперёд, и это решение человека, а не следствие того, что он
 * записал мысль.
 *
 * `to_tutor` — вопрос уходит в очередь сократического тьютора. Диалог
 * создаётся пустым, с вопросом человека дословно первой репликой; ответ
 * тьютора приходит обычным путём (`POST /api/tutor/chat`), через
 * circuit breaker и с аудитом. Если провайдеры мертвы, вопрос остаётся в
 * очереди, а заметка — на месте.
 */

const paramsSchema = z.object({ noteId: z.uuid() });
const bodySchema = z.object({ kind: z.enum(['to_experiment', 'to_tutor']) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const id = paramsSchema.safeParse(await params);
  if (!id.success) return apiError('NOT_FOUND', 'Заметка не найдена.');

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, id.data.noteId), eq(notes.userId, userId)),
  });
  if (!note) return apiError('NOT_FOUND', 'Заметка не найдена.');

  if (parsed.data.kind === 'to_experiment') {
    if (note.experimentId) {
      return NextResponse.json({ experimentId: note.experimentId, existing: true });
    }

    const draft = draftExperimentFromIdea({
      id: note.id,
      title: note.title,
      contentMd: note.contentMd,
      nodeId: note.nodeId,
    });

    const [created] = await db
      .insert(learningExperiments)
      .values({
        userId,
        hypothesis: draft.hypothesis,
        variable: draft.variable,
        armA: draft.armA,
        armB: draft.armB,
        metric: draft.metric,
        windowDays: draft.windowDays,
        status: 'draft',
      })
      .returning({ id: learningExperiments.id });

    if (!created) return apiError('INTERNAL', 'Не удалось создать эксперимент.');

    // Обратная связь двусторонняя: заметка помнит свой эксперимент, и на ней
    // видно, что мысль дошла до проверки.
    await db
      .update(notes)
      .set({ experimentId: created.id, version: note.version + 1, updatedAt: new Date() })
      .where(eq(notes.id, note.id));

    return NextResponse.json({ experimentId: created.id, draft }, { status: 201 });
  }

  if (note.tutorConversationId) {
    return NextResponse.json({ conversationId: note.tutorConversationId, existing: true });
  }

  const seed = seedTutorFromQuestion({
    id: note.id,
    title: note.title,
    contentMd: note.contentMd,
    nodeId: note.nodeId,
  });

  const [conversation] = await db
    .insert(tutorConversations)
    .values({ userId, nodeId: seed.nodeId, title: seed.title })
    .returning({ id: tutorConversations.id });

  if (!conversation) return apiError('INTERNAL', 'Не удалось создать диалог.');

  await db
    .update(notes)
    .set({
      tutorConversationId: conversation.id,
      version: note.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(notes.id, note.id));

  return NextResponse.json(
    { conversationId: conversation.id, openingMessage: seed.openingMessage },
    { status: 201 },
  );
}
