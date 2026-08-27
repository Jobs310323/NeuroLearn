import { NextResponse } from 'next/server';
import { z } from 'zod';

import { readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { hybridSearchNotes } from '@/lib/db/queries/note-search';

/**
 * Гибридный поиск по тетради.
 *
 * POST, а не GET: вектор запроса — это несколько сотен чисел, и в query они
 * не помещаются. Тело запроса, а не сохранённое состояние: вектор считает
 * клиент локальной моделью, сервер его не хранит и не пересчитывает.
 *
 * Ответ всегда сообщает, была ли семантика на самом деле (`degraded`). Молча
 * отдать полнотекстовую выдачу под видом семантической — способ заставить
 * человека доверять тому, чего не было.
 */
const searchSchema = z.object({
  q: z.string().trim().min(1).max(200),
  /**
   * Размерность фиксирована моделью (`all-MiniLM-L6-v2`, 384). Вектор другой
   * длины несопоставим с сохранёнными и был бы не «менее точным», а
   * бессмысленным.
   */
  embedding: z.array(z.number()).length(384).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const parsed = searchSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  const result = await hybridSearchNotes({
    userId,
    q: parsed.data.q,
    queryEmbedding: parsed.data.embedding,
    limit: parsed.data.limit,
  });

  return NextResponse.json(result);
}
