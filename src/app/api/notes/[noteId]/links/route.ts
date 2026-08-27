import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { listNoteLinks } from '@/lib/db/queries/notes';
import { noteLinks, notes } from '@/lib/db/schema';
import { deleteNoteLinkSchema, upsertNoteLinkSchema } from '@/lib/validation/notes';

/**
 * Типизированные связи между заметками — второй слой внутри тетради.
 *
 * Владение проверяется по ОБЕИМ заметкам сразу: связь соединяет две строки, и
 * доказательство прав на одну ничего не говорит про другую.
 */

const paramsSchema = z.object({ noteId: z.uuid() });

async function assertOwnsBoth(
  userId: string,
  fromNoteId: string,
  toNoteId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.userId, userId), inArray(notes.id, [fromNoteId, toNoteId])));
  return rows.length === 2;
}

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

  return NextResponse.json({ links: await listNoteLinks(userId, id.data.noteId) });
}

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

  const parsed = upsertNoteLinkSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  if (parsed.data.toNoteId === id.data.noteId) {
    return apiError('VALIDATION_FAILED', 'Заметка не может ссылаться сама на себя.');
  }
  if (!(await assertOwnsBoth(userId, id.data.noteId, parsed.data.toNoteId))) {
    return apiError('NOT_FOUND', 'Заметка не найдена.');
  }

  await db
    .insert(noteLinks)
    .values({
      fromNoteId: id.data.noteId,
      toNoteId: parsed.data.toNoteId,
      relation: parsed.data.relation,
      userId,
    })
    .onConflictDoNothing();

  return NextResponse.json({ linked: true }, { status: 201 });
}

export async function DELETE(
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

  const parsed = deleteNoteLinkSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  await db
    .delete(noteLinks)
    .where(
      and(
        eq(noteLinks.userId, userId),
        eq(noteLinks.fromNoteId, id.data.noteId),
        eq(noteLinks.toNoteId, parsed.data.toNoteId),
        eq(noteLinks.relation, parsed.data.relation),
      ),
    );

  return NextResponse.json({ unlinked: true });
}
