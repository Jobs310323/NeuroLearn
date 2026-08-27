import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { noteEmbeddings, notes, users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';

/**
 * Векторы заметок для семантического поиска.
 *
 * Считает их клиент — локальной моделью в воркере, тем же способом, каким в
 * проекте уже расшифровывается аудио. Сервер только хранит и сравнивает: так
 * текст заметок не уезжает наружу ради поиска, а тетрадь остаётся рабочей при
 * нулевом лимите провайдеров.
 *
 * `GET` отдаёт заметки, у которых вектора нет или он устарел (`contentHash`
 * разошёлся) — клиент считает только их. `POST` принимает готовые векторы.
 *
 * Оба маршрута отвечают 503, когда человек не разрешал AI работать с
 * заметками: молча принимать векторы при выключенной настройке значило бы
 * обходить его же решение.
 */

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;

async function assertAiAllowed(userId: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true },
  });
  return withPreferenceDefaults(user?.preferences).aiOnNotes;
}

export async function GET(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  if (!(await assertAiAllowed(userId))) {
    return apiError(
      'DISABLED',
      'AI по заметкам выключен. Включить можно в настройках — тексты заметок начнут обрабатываться локальной моделью.',
    );
  }

  const limit = Math.min(50, Number(new URL(request.url).searchParams.get('limit') ?? 20));

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      contentMd: notes.contentMd,
      storedHash: noteEmbeddings.contentHash,
      storedModel: noteEmbeddings.model,
    })
    .from(notes)
    .leftJoin(noteEmbeddings, eq(noteEmbeddings.noteId, notes.id))
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.isArchived, false),
        // Пустая заметка вектора не заслуживает: считать эмбеддинг пустой
        // строки — потратить время на шум в выдаче.
        sql`length(btrim(${notes.contentMd})) > 0`,
        or(isNull(noteEmbeddings.noteId), ne(noteEmbeddings.model, MODEL)),
      ),
    )
    .limit(limit);

  return NextResponse.json({
    model: MODEL,
    dimensions: DIMENSIONS,
    // Хеш содержимого клиент считает сам той же функцией, что и сервер
    // (`services/notes/hybrid-search.ts`): две реализации разошлись бы, и
    // вектор пересчитывался бы вечно или не пересчитывался никогда.
    pending: rows.map((row) => ({
      noteId: row.id,
      title: row.title,
      contentMd: row.contentMd,
      storedHash: row.storedHash,
    })),
  });
}

const upsertSchema = z.object({
  model: z.string().max(120),
  embeddings: z
    .array(
      z.object({
        noteId: z.uuid(),
        contentHash: z.string().min(1).max(64),
        embedding: z.array(z.number()).length(DIMENSIONS),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  if (!(await assertAiAllowed(userId))) {
    return apiError('DISABLED', 'AI по заметкам выключен.');
  }

  const parsed = upsertSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  if (parsed.data.model !== MODEL) {
    return apiError(
      'VALIDATION_FAILED',
      `Векторы разных моделей несопоставимы. Сервер ждёт ${MODEL}.`,
    );
  }

  // Владение проверяется по всем заметкам сразу: пакет с чужим id не должен
  // проходить частично.
  const ids = parsed.data.embeddings.map((item) => item.noteId);
  const owned = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.userId, userId), inArray(notes.id, ids)));
  const ownedIds = new Set(owned.map((row) => row.id));

  const accepted = parsed.data.embeddings.filter((item) => ownedIds.has(item.noteId));
  if (accepted.length === 0) return apiError('NOT_FOUND', 'Заметки не найдены.');

  const now = new Date();
  const writes = accepted.map((item) =>
    db
      .insert(noteEmbeddings)
      .values({
        noteId: item.noteId,
        userId,
        contentHash: item.contentHash,
        model: parsed.data.model,
        embedding: item.embedding,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: noteEmbeddings.noteId,
        set: {
          contentHash: item.contentHash,
          model: parsed.data.model,
          embedding: item.embedding,
          createdAt: now,
        },
      }),
  );

  if (writes.length === 1) await writes[0];
  else await db.batch(writes as [(typeof writes)[number], ...typeof writes]);

  // Бейдж «AI обработал» ставится отдельным запросом, а не в том же batch:
  // типы insert и update в batch не сводятся к одному кортежу, а атомарность
  // здесь ничего не решает — бейдж без вектора означает лишь лишнюю метку,
  // вектор без бейджа исправится следующим проходом.
  await db
    .update(notes)
    .set({ aiProcessedAt: now })
    .where(
      and(
        eq(notes.userId, userId),
        inArray(
          notes.id,
          accepted.map((item) => item.noteId),
        ),
      ),
    );

  return NextResponse.json({ stored: accepted.length });
}
