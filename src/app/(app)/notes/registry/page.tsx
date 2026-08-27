import { and, desc, eq, gte } from 'drizzle-orm';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUserId } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { knowledgeNodes, notes } from '@/lib/db/schema';
import { clusterConfusions } from '@/lib/services/notes/pipelines';

export const metadata = { title: 'Реестр непонимания — NeuroLearn' };

/**
 * Реестр непонимания — недельный разбор того, что было помечено «не понял».
 *
 * Смысл раздела не в списке, а в повторах. Одна пометка — обычный ход
 * обучения; три на одном узле за неделю — тема, которая не даётся, и её
 * лечит не повторение теории, а контрастные случаи: два близких примера с
 * выделенным критическим различием.
 *
 * Никакой оценки человека здесь нет и быть не может: пометка «не понял» —
 * это честность, за которую наказывать было бы прямо вредно.
 */
export default async function ConfusionRegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const days = Math.min(90, Math.max(1, Number(params.days) || 7));
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await db
    .select({
      noteId: notes.id,
      title: notes.title,
      nodeId: notes.nodeId,
      nodeTitle: knowledgeNodes.title,
      createdAt: notes.createdAt,
      pathId: knowledgeNodes.pathId,
    })
    .from(notes)
    .leftJoin(knowledgeNodes, eq(knowledgeNodes.id, notes.nodeId))
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.confusionFlag, true),
        eq(notes.isArchived, false),
        gte(notes.createdAt, since),
      ),
    )
    .orderBy(desc(notes.createdAt));

  const clusters = clusterConfusions(rows);
  const pathByNode = new Map(rows.map((row) => [row.nodeId, row.pathId]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-medium">Реестр непонимания</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Что было помечено «не понял» за последние {days} дн. Пометка — не ошибка и не
          оценка: это единственный способ поймать непонимание, пока оно сформулировано.
        </p>
      </header>

      <nav className="flex gap-1.5 text-xs" aria-label="Период">
        {[7, 14, 30].map((value) => (
          <Button
            key={value}
            size="sm"
            variant={value === days ? 'default' : 'secondary'}
            asChild
          >
            <Link href={`/notes/registry?days=${value}`}>{value} дн.</Link>
          </Button>
        ))}
      </nav>

      {clusters.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-sm text-fg-muted">
            За этот период пометок нет. Флаг «не понял» ставится прямо в практике, рядом с
            кнопкой «Ответить».
          </CardContent>
        </Card>
      ) : (
        clusters.map((cluster) => (
          <Card key={cluster.nodeId ?? 'none'}>
            <CardHeader>
              <CardTitle>{cluster.nodeTitle}</CardTitle>
              <CardDescription>
                Пометок: {cluster.count}
                {cluster.suggestsContrast
                  ? ' — повторяется. Похоже на смешение двух понятий, а не на пробел.'
                  : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-1.5 text-sm">
                {cluster.entries.map((entry) => (
                  <li key={entry.noteId} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/notes?note=${entry.noteId}`}
                      className="min-w-0 truncate text-fg hover:underline"
                    >
                      {entry.title ?? 'Без названия'}
                    </Link>
                    <span className="shrink-0 text-xs text-fg-subtle">
                      {entry.createdAt.toLocaleDateString('ru-RU')}
                    </span>
                  </li>
                ))}
              </ul>

              {cluster.suggestsContrast && cluster.nodeId ? (
                <Button size="sm" variant="secondary" className="self-start" asChild>
                  <Link href={`/paths/${pathByNode.get(cluster.nodeId) ?? ''}`}>
                    Открыть узел и разобрать контрастные случаи
                  </Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
