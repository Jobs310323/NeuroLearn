'use server';

import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { revalidatePath } from 'next/cache';

import { requireUserId } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { learningPaths, sourceChunks, sourceDocuments } from '@/lib/db/schema';
import { extractChunks, UnsupportedSourceKindError, type SourceKind } from '@/lib/services/sources/extract';
import {
  attachSourceSchema,
  deleteSourceSchema,
  uploadSourceMetaSchema,
} from '@/lib/validation/sources';

import type { ActionResult } from '../learning-path/actions';

/**
 * Импорт источников — тонкий слой поверх `extractChunks`: раскладывает файл
 * или вставленный текст на фрагменты и пишет их атомарно вместе со статусом
 * документа. Оригинал файла никуда не сохраняется — только извлечённый текст.
 */

const MAX_CHUNKS_PER_DOCUMENT = 600;

async function assertOwnsPath(userId: string, pathId: string): Promise<boolean> {
  const path = await db.query.learningPaths.findFirst({
    where: and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)),
    columns: { id: true },
  });
  return Boolean(path);
}

function kindFromFilename(name: string): SourceKind {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'wav') return 'audio';
  return 'plain_text';
}

export async function uploadSource(formData: FormData): Promise<ActionResult<{ documentId: string }>> {
  const userId = await requireUserId();

  const pathIdRaw = String(formData.get('pathId') ?? '').trim();
  const parsedMeta = uploadSourceMetaSchema.safeParse({
    title: String(formData.get('title') ?? ''),
    pathId: pathIdRaw || null,
  });
  if (!parsedMeta.success) {
    return { ok: false, error: parsedMeta.error.issues[0]?.message ?? 'Некорректные данные' };
  }
  const { title, pathId } = parsedMeta.data;

  if (pathId && !(await assertOwnsPath(userId, pathId))) {
    return { ok: false, error: 'Путь не найден' };
  }

  const file = formData.get('file');
  const pastedText = String(formData.get('text') ?? '').trim();

  let kind: SourceKind;
  let buffer: Uint8Array | undefined;
  let text = '';
  let originalFilename: string | null = null;

  if (file instanceof File && file.size > 0) {
    kind = kindFromFilename(file.name);
    originalFilename = file.name;
    if (kind === 'pdf' || kind === 'audio') {
      buffer = new Uint8Array(await file.arrayBuffer());
    } else {
      text = await file.text();
    }
  } else if (pastedText) {
    kind = 'ai_notes';
    text = pastedText;
  } else {
    return { ok: false, error: 'Загрузите файл или вставьте текст' };
  }

  const [doc] = await db
    .insert(sourceDocuments)
    .values({ userId, pathId: pathId ?? null, title, kind, status: 'extracting', originalFilename })
    .returning({ id: sourceDocuments.id });

  if (!doc) return { ok: false, error: 'Не удалось создать документ' };

  try {
    const chunks = (await extractChunks(kind, { buffer, text })).slice(0, MAX_CHUNKS_PER_DOCUMENT);
    if (chunks.length === 0) {
      throw new Error('Не удалось извлечь текст — файл пуст или нечитаем');
    }

    const charCount = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);

    const chunkInserts = chunks.map((chunk, index) =>
      db.insert(sourceChunks).values({
        documentId: doc.id,
        userId,
        orderIndex: index,
        headingPath: chunk.headingPath,
        content: chunk.content,
        charCount: chunk.content.length,
        pageNumber: chunk.pageNumber,
      }),
    );

    const finalizeDoc = db
      .update(sourceDocuments)
      .set({ status: 'ready', charCount, chunkCount: chunks.length, updatedAt: new Date() })
      .where(eq(sourceDocuments.id, doc.id));

    // Драйвер neon-http не даёт интерактивных транзакций — пишем одним batch,
    // чтобы документ не завис в `extracting`, если часть чанков не запишется.
    await db.batch(
      [...chunkInserts, finalizeDoc] as unknown as [BatchItem<'pg'>, ...BatchItem<'pg'>[]],
    );
  } catch (error) {
    const message =
      error instanceof UnsupportedSourceKindError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Не удалось обработать источник';

    await db
      .update(sourceDocuments)
      .set({ status: 'failed', failureReason: message, updatedAt: new Date() })
      .where(eq(sourceDocuments.id, doc.id));

    revalidatePath('/sources');
    return { ok: false, error: message };
  }

  revalidatePath('/sources');
  return { ok: true, data: { documentId: doc.id } };
}

export async function deleteSource(input: unknown): Promise<ActionResult<null>> {
  const userId = await requireUserId();
  const parsed = deleteSourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  await db
    .delete(sourceDocuments)
    .where(and(eq(sourceDocuments.id, parsed.data.documentId), eq(sourceDocuments.userId, userId)));

  revalidatePath('/sources');
  return { ok: true, data: null };
}

export async function attachSourceToPath(input: unknown): Promise<ActionResult<null>> {
  const userId = await requireUserId();
  const parsed = attachSourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }
  const { documentId, pathId } = parsed.data;

  if (pathId && !(await assertOwnsPath(userId, pathId))) {
    return { ok: false, error: 'Путь не найден' };
  }

  await db
    .update(sourceDocuments)
    .set({ pathId, updatedAt: new Date() })
    .where(and(eq(sourceDocuments.id, documentId), eq(sourceDocuments.userId, userId)));

  revalidatePath('/sources');
  return { ok: true, data: null };
}
