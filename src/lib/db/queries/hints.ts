import { and, asc, eq, inArray, isNotNull, lte, or } from 'drizzle-orm';

import { db } from '@/lib/db';
import { knowledgeNodes, nodeEdges, notes, users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';

/**
 * Данные, которые движку подсказок нужны с сервера.
 *
 * Собираются один раз при старте сессии и отдаются клиенту целиком: правила —
 * чистые функции, им нужен готовый контекст, а не возможность сходить за
 * данными по ходу. Побочный эффект приятный: подсказки продолжают работать,
 * когда сеть отвалилась посреди сессии.
 */

export type HintBootstrap = {
  enabled: boolean;
  disabledRules: string[];
  /** Соседи узлов по графу (related/contrast, BFS-1) — для контрастного правила. */
  neighbours: Record<string, string[]>;
  /** Живые заметки, которым пора вернуться, по узлам этой сессии. */
  dueNotes: { noteId: string; title: string; nodeId: string }[];
};

/** Только «мягкие» связи: prerequisite задаёт порядок, а не близость тем. */
const NEIGHBOUR_RELATIONS = ['related', 'contrast', 'analogous'] as const;

export async function loadHintBootstrap(
  userId: string,
  nodeIds: string[],
  now = new Date(),
): Promise<HintBootstrap> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true },
  });
  const preferences = withPreferenceDefaults(user?.preferences);

  if (nodeIds.length === 0) {
    return {
      enabled: preferences.hints.enabled,
      disabledRules: preferences.hints.disabledRules,
      neighbours: {},
      dueNotes: [],
    };
  }

  const [edgeRows, noteRows] = await Promise.all([
    db
      .select({
        sourceId: nodeEdges.sourceId,
        targetId: nodeEdges.targetId,
      })
      .from(nodeEdges)
      // Связи ненаправленные по смыслу («похоже на»), поэтому берём обе стороны.
      .where(
        and(
          inArray(nodeEdges.relation, [...NEIGHBOUR_RELATIONS]),
          or(inArray(nodeEdges.sourceId, nodeIds), inArray(nodeEdges.targetId, nodeIds)),
        ),
      ),
    db
      .select({ id: notes.id, title: notes.title, nodeId: notes.nodeId })
      .from(notes)
      .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, notes.nodeId))
      .where(
        and(
          eq(notes.userId, userId),
          eq(notes.isArchived, false),
          inArray(notes.nodeId, nodeIds),
          isNotNull(notes.resurfaceAt),
          lte(notes.resurfaceAt, now),
        ),
      )
      .orderBy(asc(notes.resurfaceAt))
      .limit(5),
  ]);

  const neighbours: Record<string, string[]> = {};
  const push = (from: string, to: string) => {
    const list = neighbours[from];
    if (list) {
      if (!list.includes(to)) list.push(to);
    } else neighbours[from] = [to];
  };
  for (const edge of edgeRows) {
    push(edge.sourceId, edge.targetId);
    push(edge.targetId, edge.sourceId);
  }

  return {
    enabled: preferences.hints.enabled,
    disabledRules: preferences.hints.disabledRules,
    neighbours,
    dueNotes: noteRows
      .filter((row): row is { id: string; title: string | null; nodeId: string } =>
        row.nodeId !== null,
      )
      .map((row) => ({
        noteId: row.id,
        title: row.title ?? 'Без названия',
        nodeId: row.nodeId,
      })),
  };
}
