import { and, eq, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { fsrsCards, knowledgeNodes, notes } from '@/lib/db/schema';
import { logError, logEvent } from '@/lib/monitoring/logger';
import { scheduleNotes, type NodeReviewState } from '@/lib/services/notes/resurface';

/**
 * Vercel Cron: пересчёт дат возврата живых заметок.
 *
 * Почему пакетно, а не «на лету при чтении». Дата возврата зависит от
 * состояния карточки FSRS, а оно меняется при каждом повторении — считать её
 * в момент показа списка значило бы делать один и тот же расчёт на каждый
 * рендер и по всем заметкам сразу. Пакетный пересчёт раз в сутки даёт то же
 * с точностью до дня, а точнее и не нужно: заметка поднимается за 12 часов до
 * повторения.
 *
 * Капсулы времени этот расчёт не трогает — там дату назначил человек
 * (`services/notes/resurface.ts`).
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 });
    }
    console.warn('CRON_SECRET не задан: эндпоинт открыт. В production это ответ 500.');
  } else if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();

  try {
    // Только заякоренные и живые: у остальных возвращать нечего.
    const rows = await db
      .select({
        id: notes.id,
        userId: notes.userId,
        nodeId: notes.nodeId,
        resurfaceAt: notes.resurfaceAt,
        capsule: notes.capsule,
        isArchived: notes.isArchived,
        updatedAt: notes.updatedAt,
        nodeStatus: knowledgeNodes.status,
      })
      .from(notes)
      .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, notes.nodeId))
      .where(and(isNotNull(notes.nodeId), eq(notes.isArchived, false)));

    if (rows.length === 0) {
      return NextResponse.json({ scheduled: 0, cleared: 0 });
    }

    const cards = await db
      .select({ nodeId: fsrsCards.nodeId, userId: fsrsCards.userId, due: fsrsCards.due })
      .from(fsrsCards);
    const dueByKey = new Map(cards.map((c) => [`${c.userId}:${c.nodeId}`, c.due]));

    const nodeStates: NodeReviewState[] = rows.map((row) => ({
      nodeId: row.nodeId!,
      due: dueByKey.get(`${row.userId}:${row.nodeId}`) ?? null,
      status: row.nodeStatus,
    }));

    const decisions = scheduleNotes(
      rows.map((row) => ({
        noteId: row.id,
        resurfaceAt: row.resurfaceAt,
        isCapsule: row.capsule !== null,
        nodeId: row.nodeId,
        isArchived: row.isArchived,
        updatedAt: row.updatedAt,
      })),
      nodeStates,
      now,
    );

    // Версия заметки НЕ трогается: планировщик меняет служебное поле, а не
    // авторский текст. Инкремент версии здесь порождал бы ложные конфликты у
    // человека, который в этот момент правит заметку с телефона.
    const updates = decisions.map((decision) =>
      db
        .update(notes)
        .set({ resurfaceAt: decision.resurfaceAt, resurfaceReason: decision.reason })
        .where(eq(notes.id, decision.noteId)),
    );

    if (updates.length === 1) await updates[0];
    else if (updates.length > 1) {
      await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
    }

    const scheduled = decisions.filter((d) => d.resurfaceAt !== null).length;
    logEvent('notes-resurface', { scheduled, cleared: decisions.length - scheduled });

    return NextResponse.json({ scheduled, cleared: decisions.length - scheduled });
  } catch (error) {
    logError(error, 'cron:notes-resurface');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
