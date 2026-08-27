import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { unauthorized } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { knowledgeNodes, noteLinks, nodeProgress, notes, users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';
import { draftWeeklyNarrative } from '@/lib/ai/agents/notes-analyst';
import { logError } from '@/lib/monitoring/logger';
import {
  findContradictions,
  summarizeWeek,
  type NodeEvidence,
  type WeekNote,
} from '@/lib/services/notes/weekly';

/**
 * Итог недели.
 *
 * Двухслойный ответ и в этом весь смысл раздела. `stats` и `contradictions`
 * считаются детерминированно и приходят всегда — при выключенном AI, при
 * мёртвых провайдерах, при нулевом лимите. `narrative` — черновик от модели,
 * и его может не быть; когда его нет, ответ прямо говорит почему, а не
 * притворяется, что итога недели не существует.
 *
 * Порядок именно такой: сначала посчитать, потом (может быть) описать. Дать
 * модели сырые заметки и попросить «подведи итог» значило бы получить
 * убедительный текст, проверить который нечем.
 */

const WEEK_MS = 7 * 86_400_000;

export async function GET(): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const since = new Date(Date.now() - WEEK_MS);

  const [rows, user] = await Promise.all([
    db
      .select({
        id: notes.id,
        type: notes.type,
        title: notes.title,
        contentMd: notes.contentMd,
        nodeId: notes.nodeId,
        createdAt: notes.createdAt,
        confusionFlag: notes.confusionFlag,
        linkCount: sql<number>`(
          select count(*)::int from ${noteLinks}
          where ${noteLinks.fromNoteId} = ${notes.id} or ${noteLinks.toNoteId} = ${notes.id}
        )`,
      })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          eq(notes.isArchived, false),
          gte(notes.createdAt, since),
        ),
      ),
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { preferences: true },
    }),
  ]);

  const weekNotes: WeekNote[] = rows;
  const stats = summarizeWeek(weekNotes);

  const nodeIds = [...new Set(weekNotes.flatMap((note) => (note.nodeId ? [note.nodeId] : [])))];
  const evidence: NodeEvidence[] =
    nodeIds.length === 0
      ? []
      : (
          await db
            .select({
              nodeId: knowledgeNodes.id,
              nodeTitle: knowledgeNodes.title,
              status: knowledgeNodes.status,
              accuracyRate: nodeProgress.accuracyRate,
              totalReps: nodeProgress.totalReps,
            })
            .from(knowledgeNodes)
            .innerJoin(nodeProgress, eq(nodeProgress.nodeId, knowledgeNodes.id))
            .where(
              and(eq(nodeProgress.userId, userId), inArray(knowledgeNodes.id, nodeIds)),
            )
        ).map((row) => ({ ...row }));

  const contradictions = findContradictions(weekNotes, evidence);
  const nodeTitleById = new Map(evidence.map((item) => [item.nodeId, item.nodeTitle]));

  const aiOnNotes = withPreferenceDefaults(user?.preferences).aiOnNotes;

  const deterministic = {
    stats: {
      ...stats,
      topNodes: stats.topNodes.map((node) => ({
        ...node,
        title: nodeTitleById.get(node.nodeId) ?? 'Узел',
      })),
    },
    contradictions,
  };

  if (!aiOnNotes) {
    return NextResponse.json({
      ...deterministic,
      narrative: null,
      narrativeUnavailable: 'ai_off',
    });
  }

  if (stats.total === 0) {
    // Пустая неделя: писать по ней нарратив нечем, и просить об этом модель
    // значит просить её сочинить.
    return NextResponse.json({
      ...deterministic,
      narrative: null,
      narrativeUnavailable: 'no_data',
    });
  }

  try {
    const { narrative } = await draftWeeklyNarrative({
      userId,
      stats,
      topNodeTitles: deterministic.stats.topNodes.map((node) => node.title),
      contradictions: contradictions.map((item) => ({
        noteTitle: item.noteTitle,
        nodeTitle: item.nodeTitle,
        evidence: item.evidence,
      })),
    });

    return NextResponse.json({ ...deterministic, narrative, narrativeUnavailable: null });
  } catch (error) {
    // Провайдеры молчат — итог недели всё равно есть, просто без нарратива.
    // Это и есть заявленная деградация: числа важнее текста о числах.
    logError(error, 'notes:weekly-digest');
    return NextResponse.json({
      ...deterministic,
      narrative: null,
      narrativeUnavailable: 'provider_down',
    });
  }
}

export const dynamic = 'force-dynamic';
