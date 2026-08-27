import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { getNote } from '@/lib/db/queries/notes';
import { notes } from '@/lib/db/schema';
import { conflictCopyTitle, decideNoteWrite } from '@/lib/services/notes/conflict';
import { updateNoteSchema } from '@/lib/validation/notes';

/**
 * Чтение, правка и удаление одной заметки.
 *
 * Правка идёт через оптимистическую блокировку по `version`. При расхождении
 * сервер отвечает 409 и отдаёт СВОЮ версию заметки целиком — клиенту нужен
 * не факт конфликта, а обе стороны, чтобы сохранить их рядом и дать человеку
 * разобрать вручную. Автослияние текста здесь запрещено намеренно
 * (`services/notes/conflict.ts`).
 */

const paramsSchema = z.object({ noteId: z.uuid() });

export async function GET(
  _request: Request,
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

  const note = await getNote(userId, id.data.noteId);
  if (!note) return apiError('NOT_FOUND', 'Заметка не найдена.');
  return NextResponse.json(note);
}

export async function PATCH(
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

  const parsed = updateNoteSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);
  const input = parsed.data;

  const current = await db.query.notes.findFirst({
    where: and(eq(notes.id, id.data.noteId), eq(notes.userId, userId)),
  });
  if (!current) return apiError('NOT_FOUND', 'Заметка не найдена.');

  const decision = decideNoteWrite({
    baseVersion: input.version,
    serverVersion: current.version,
    serverContentMd: current.contentMd,
    incomingContentMd: input.contentMd ?? current.contentMd,
  });

  if (decision.kind === 'already_applied') {
    return NextResponse.json({
      id: current.id,
      version: current.version,
      updatedAt: current.updatedAt.toISOString(),
      deduplicated: true,
    });
  }

  if (decision.kind === 'conflict') {
    const server = await getNote(userId, current.id);
    return NextResponse.json(
      {
        error: {
          code: 'VERSION_CONFLICT',
          message:
            'Заметка изменилась в другом месте. Сохраните обе версии и сведите их вручную — текст не теряется.',
        },
        serverVersion: current.version,
        serverNote: server,
        /** Готовый заголовок для копии — чтобы клиент не изобретал свой формат. */
        suggestedConflictTitle: conflictCopyTitle(current.title, new Date()),
      },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = {
    version: decision.nextVersion,
    updatedAt: new Date(),
  };
  const assign = <K extends string>(key: K, value: unknown) => {
    if (value !== undefined) patch[key] = value;
  };

  assign('type', input.type);
  assign('title', input.title === undefined ? undefined : (input.title ?? null));
  assign('contentMd', input.contentMd);
  assign('colorLabel', input.colorLabel);
  assign('tags', input.tags);
  assign('nodeId', input.nodeId === undefined ? undefined : (input.nodeId ?? null));
  assign('sessionId', input.sessionId === undefined ? undefined : (input.sessionId ?? null));
  assign(
    'assessmentId',
    input.assessmentId === undefined ? undefined : (input.assessmentId ?? null),
  );
  assign(
    'experimentId',
    input.experimentId === undefined ? undefined : (input.experimentId ?? null),
  );
  assign('sourceId', input.sourceId === undefined ? undefined : (input.sourceId ?? null));
  assign(
    'sourceAnchor',
    input.sourceAnchor === undefined ? undefined : (input.sourceAnchor ?? null),
  );
  assign(
    'parentNoteId',
    input.parentNoteId === undefined ? undefined : (input.parentNoteId ?? null),
  );
  assign(
    'resurfaceAt',
    input.resurfaceAt === undefined ? undefined : input.resurfaceAt ? new Date(input.resurfaceAt) : null,
  );
  assign(
    'resurfaceReason',
    input.resurfaceReason === undefined ? undefined : (input.resurfaceReason ?? null),
  );
  assign('capsule', input.capsule === undefined ? undefined : (input.capsule ?? null));
  assign('confusionFlag', input.confusionFlag);
  assign('pinned', input.pinned);
  assign('isArchived', input.isArchived);

  // Условие по `version` повторяет решение в SQL: между чтением выше и этой
  // записью могла пройти чужая правка (интерактивных транзакций у neon-http
  // нет). Ноль обновлённых строк — тот же конфликт, только пойманный позже.
  const updated = await db
    .update(notes)
    .set(patch)
    .where(
      and(
        eq(notes.id, current.id),
        eq(notes.userId, userId),
        eq(notes.version, current.version),
      ),
    )
    .returning({ id: notes.id, version: notes.version, updatedAt: notes.updatedAt });

  const row = updated[0];
  if (!row) {
    const server = await getNote(userId, current.id);
    return NextResponse.json(
      {
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Заметку изменили в момент сохранения. Сохраните обе версии.',
        },
        serverVersion: server?.version ?? current.version,
        serverNote: server,
        suggestedConflictTitle: conflictCopyTitle(current.title, new Date()),
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    id: row.id,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function DELETE(
  _request: Request,
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

  const deleted = await db
    .delete(notes)
    .where(and(eq(notes.id, id.data.noteId), eq(notes.userId, userId)))
    .returning({ id: notes.id });

  if (deleted.length === 0) return apiError('NOT_FOUND', 'Заметка не найдена.');
  return NextResponse.json({ deleted: true });
}
