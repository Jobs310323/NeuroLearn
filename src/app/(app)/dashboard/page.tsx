import Link from 'next/link';

import { ScienceHint } from '@/components/science-hint';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUserId } from '@/lib/auth/require-user';
import { listPaths } from '@/lib/db/queries/paths';

export default async function DashboardPage() {
  const userId = await requireUserId();
  const paths = await listPaths(userId);

  const totalNodes = paths.reduce((sum, p) => sum + p.nodeCount, 0);
  const automated = paths.reduce((sum, p) => sum + p.automatedCount, 0);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Обзор</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Прогресс измеряется автоматизмом, а не количеством пройденных материалов.
      </p>

      <div className="mt-8 grid grid-cols-3 gap-4">
        <Stat label="Путей" value={paths.length} />
        <Stat label="Узлов знаний" value={totalNodes} />
        <Stat
          label="Доведено до автоматизма"
          value={automated}
          hint={
            <ScienceHint citation="automaticity" />
          }
        />
      </div>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Пути обучения</h2>
          <Button asChild size="sm">
            <Link href="/paths/new">Новый путь</Link>
          </Button>
        </div>

        {paths.length === 0 ? (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Пока пусто</CardTitle>
              <CardDescription>
                Начните с цели: чему именно нужно научиться и до какого уровня.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/paths/new">Поставить цель</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="mt-4 grid gap-3">
            {paths.map((path) => (
              <li key={path.id}>
                <Link href={`/paths/${path.id}`} className="block">
                  <Card className="transition-colors hover:bg-bg-hover">
                    <CardHeader>
                      <CardTitle>{path.title}</CardTitle>
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
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-1.5 text-xs text-fg-muted">
          {label}
          {hint}
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
