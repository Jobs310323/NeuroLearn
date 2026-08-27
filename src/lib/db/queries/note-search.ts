import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { noteEmbeddings, notes, users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';
import { toTsQuery } from '@/lib/notes/search';
import {
  cosineSimilarity,
  fuseRrf,
  toRanked,
  type FusedHit,
} from '@/lib/services/notes/hybrid-search';
import { logError } from '@/lib/monitoring/logger';

/**
 * Гибридный поиск по тетради: полнотекстовый плюс векторный, слитые через RRF.
 *
 * Главное свойство — честная деградация. Векторный слой отваливается по трём
 * независимым причинам, и каждая должна быть видна в ответе, а не только в
 * логе:
 *
 *   `ai_off`      — человек не разрешал AI работать с заметками (умолчание);
 *   `no_query_vector` — клиент не прислал вектор запроса (модель ещё грузится);
 *   `no_index`    — в базе нет расширения `vector` или таблицы эмбеддингов.
 *
 * Во всех трёх случаях поиск работает: возвращается полнотекстовая выдача.
 * Молча притворяться, что семантика была, — худшее из решений: человек
 * доверился бы выдаче, которой не было.
 */

export type HybridDegradation = 'ai_off' | 'no_query_vector' | 'no_index' | null;

export type HybridSearchResult = {
  hits: (FusedHit & { title: string | null; excerpt: string })[];
  degraded: HybridDegradation;
};

/** Сколько кандидатов берём из каждого источника до слияния. */
const CANDIDATES = 40;

export async function hybridSearchNotes(params: {
  userId: string;
  q: string;
  /** Вектор запроса, посчитанный на клиенте той же локальной моделью. */
  queryEmbedding?: number[];
  limit?: number;
}): Promise<HybridSearchResult> {
  const limit = params.limit ?? 20;
  const tsQuery = toTsQuery(params.q);

  const ftsRows = tsQuery
    ? await db
        .select({ id: notes.id, title: notes.title, contentMd: notes.contentMd })
        .from(notes)
        .where(
          and(
            eq(notes.userId, params.userId),
            eq(notes.isArchived, false),
            sql`to_tsvector('simple', coalesce(${notes.title}, '') || ' ' || ${notes.contentMd}) @@ to_tsquery('simple', ${tsQuery})`,
          ),
        )
        .orderBy(
          sql`ts_rank(to_tsvector('simple', coalesce(${notes.title}, '') || ' ' || ${notes.contentMd}), to_tsquery('simple', ${tsQuery})) desc`,
        )
        .limit(CANDIDATES)
    : [];

  const user = await db.query.users.findFirst({
    where: eq(users.id, params.userId),
    columns: { preferences: true },
  });
  const aiOnNotes = withPreferenceDefaults(user?.preferences).aiOnNotes;

  let degraded: HybridDegradation = null;
  let vectorIds: string[] = [];

  if (!aiOnNotes) {
    degraded = 'ai_off';
  } else if (!params.queryEmbedding || params.queryEmbedding.length === 0) {
    degraded = 'no_query_vector';
  } else {
    try {
      vectorIds = await vectorCandidates(params.userId, params.queryEmbedding);
    } catch (error) {
      // Нет расширения `vector`, нет таблицы, оборвалось соединение — для
      // человека это одно и то же: семантики сейчас нет. Причина уходит в лог,
      // ответу достаточно факта.
      logError(error, 'notes:hybrid-search:vector');
      degraded = 'no_index';
    }
  }

  const fused = fuseRrf(
    toRanked(ftsRows.map((row) => row.id)),
    toRanked(vectorIds),
  ).slice(0, limit);

  // Тексты добираются только для победивших: тянуть содержимое всех
  // кандидатов ради двадцати строк выдачи незачем.
  const byId = new Map(ftsRows.map((row) => [row.id, row]));
  const missing = fused.filter((hit) => !byId.has(hit.id)).map((hit) => hit.id);

  if (missing.length > 0) {
    const rows = await db
      .select({ id: notes.id, title: notes.title, contentMd: notes.contentMd })
      .from(notes)
      .where(and(eq(notes.userId, params.userId), sql`${notes.id} = any(${missing})`));
    for (const row of rows) byId.set(row.id, row);
  }

  return {
    degraded,
    hits: fused.map((hit) => {
      const row = byId.get(hit.id);
      return {
        ...hit,
        title: row?.title ?? null,
        excerpt: (row?.contentMd ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      };
    }),
  };
}

/**
 * Кандидаты по вектору.
 *
 * Близость считается в приложении, а не в SQL: векторы лежат как
 * `double precision[]`, потому что расширение `vector` есть не в каждой
 * установке, и завязывать на него работоспособность тетради нельзя. Тетрадь
 * одного человека — тысячи заметок, а не миллионы, и полный проход по ним
 * дешевле, чем требование к инфраструктуре.
 *
 * Когда расширение появится, здесь меняется одна функция, а не поиск целиком —
 * ради этого слияние (`fuseRrf`) и работает с рангами, а не с оценками.
 */
async function vectorCandidates(userId: string, queryEmbedding: number[]): Promise<string[]> {
  const rows = await db
    .select({ noteId: noteEmbeddings.noteId, embedding: noteEmbeddings.embedding })
    .from(noteEmbeddings)
    .innerJoin(notes, eq(notes.id, noteEmbeddings.noteId))
    .where(and(eq(noteEmbeddings.userId, userId), eq(notes.isArchived, false)));

  return rows
    .map((row) => ({
      id: row.noteId,
      score: cosineSimilarity(queryEmbedding, row.embedding),
    }))
    // Отрицательная близость означает противоположное направление — такие
    // заметки в выдаче семантического поиска не нужны вовсе.
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, CANDIDATES)
    .map((row) => row.id);
}
