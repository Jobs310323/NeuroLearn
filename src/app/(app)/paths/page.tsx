import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUserId } from '@/lib/auth/require-user';
import { listPaths } from '@/lib/db/queries/paths';

const STATUS_LABEL: Record<string, string> = {
  draft: 'черновик',
  active: 'активен',
  paused: 'на паузе',
  completed: 'завершён',
  archived: 'в архиве',
};

export default async function PathsPage() {
  const userId = await requireUserId();
  const paths = await listPaths(userId);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Пути обучения</h1>
        <Button asChild size="sm">
          <Link href="/paths/new">Новый путь</Link>
        </Button>
      </div>

      {paths.length === 0 ? (
        <p className="mt-8 text-sm text-fg-muted">
          Путей пока нет. Создайте первый — начните с формулировки цели.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {paths.map((path) => (
            <li key={path.id}>
              <Link href={`/paths/${path.id}`} className="block">
                <Card className="transition-colors hover:bg-bg-hover">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <CardTitle>{path.title}</CardTitle>
                      <span className="shrink-0 text-xs text-fg-subtle">
                        {STATUS_LABEL[path.status] ?? path.status}
                      </span>
                    </div>
                    <CardDescription className="line-clamp-2">{path.goal}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-fg-subtle">
                    {path.nodeCount} узлов · освоено {path.masteredCount} · автоматизм{' '}
                    {path.automatedCount}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
