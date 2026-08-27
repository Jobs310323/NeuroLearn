import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { listNotes } from '@/lib/db/queries/notes';
import { notes } from '@/lib/db/schema';
import { createNoteSchema, listNotesQuerySchema } from '@/lib/validation/notes';

/**
 * Тетрадь: список и создание.
 *
 * `GET /api/notes` — фильтры и полнотекстовый поиск (`q`), всё
 * детерминированно и без участия модели. Тетрадь обязана работать целиком
 * при мёртвых провайдерах — поиск в том числе.
 *
 * `POST /api/notes` — создание. Идентификатор можно задать клиентом: это
 * делает отправку идемпотентной, и повтор из офлайн-очереди не создаёт
 * дубль. Публичный API захвата (`POST /api/notes`) — этот же обработчик.
 */

export async function GET(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const url = new URL(request.url);
  const parsed = listNotesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return validationFailed(parsed.error);

  const { items, total } = await listNotes(userId, parsed.data);
  return NextResponse.json({ items, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const parsed = createNoteSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);
  const input = parsed.data;

  if (input.id) {
    // Повтор отправки из очереди: заметка уже есть — отвечаем ею же, а не
    // ошибкой. Иначе очередь считает отправку неудачной и повторяет вечно.
    const existing = await db.query.notes.findFirst({
      where: and(eq(notes.id, input.id), eq(notes.userId, userId)),
      columns: { id: true, version: true, updatedAt: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          id: existing.id,
          version: existing.version,
          updatedAt: existing.updatedAt.toISOString(),
          deduplicated: true,
        },
        { status: 200 },
      );
    }
  }

  const [created] = await db
    .insert(notes)
    .values({
      ...(input.id ? { id: input.id } : {}),
      userId,
      type: input.type,
      title: input.title ?? null,
      contentMd: input.contentMd,
      colorLabel: input.colorLabel,
      tags: input.tags,
      nodeId: input.nodeId ?? null,
      sessionId: input.sessionId ?? null,
      assessmentId: input.assessmentId ?? null,
      experimentId: input.experimentId ?? null,
      sourceId: input.sourceId ?? null,
      sourceAnchor: input.sourceAnchor ?? null,
      parentNoteId: input.parentNoteId ?? null,
      resurfaceAt: input.resurfaceAt ? new Date(input.resurfaceAt) : null,
      resurfaceReason: input.resurfaceReason ?? null,
      capsule: input.capsule ?? null,
      confusionFlag: input.confusionFlag,
      pinned: input.pinned,
      conflictOfNoteId: input.conflictOfNoteId ?? null,
    })
    .returning({
      id: notes.id,
      version: notes.version,
      updatedAt: notes.updatedAt,
    });

  if (!created) return apiError('INTERNAL', 'Не удалось создать заметку.');

  return NextResponse.json(
    { id: created.id, version: created.version, updatedAt: created.updatedAt.toISOString() },
    { status: 201 },
  );
}
