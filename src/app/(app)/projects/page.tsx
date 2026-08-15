import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUserId } from '@/lib/auth/require-user';
import { listPaths } from '@/lib/db/queries/paths';
import { listProjectsForPath } from '@/lib/db/queries/projects';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  submitted: 'Сдан, ждёт защиты',
  in_defense: 'Идёт защита',
  revisions_requested: 'Нужны доработки',
  accepted: 'Принят',
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ pathId?: string }>;
}) {
  const userId = await requireUserId();
  const { pathId } = await searchParams;
  const paths = await listPaths(userId);
  const projects = pathId ? await listProjectsForPath(userId, pathId) : null;

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Проекты</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Перенос навыка в реальный контекст. ИИ на защите задаёт вопросы по артефакту —
        не пишет и не исправляет решение за вас.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {paths.map((p) => (
          <Link
            key={p.id}
            href={`/projects?pathId=${p.id}`}
            className={
              p.id === pathId
                ? 'rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg'
                : 'rounded-full border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-hover'
            }
          >
            {p.title}
          </Link>
        ))}
      </div>

      {!pathId ? (
        <p className="mt-8 text-sm text-fg-subtle">Выберите путь, чтобы увидеть его проекты.</p>
      ) : projects === null ? (
        <p className="mt-8 text-sm text-fg-subtle">Путь не найден.</p>
      ) : projects.length === 0 ? (
        <p className="mt-8 text-sm text-fg-subtle">
          У этого пути пока нет проектов — они добавляются вместе с генерацией дерева.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`}>
                <Card className="transition-colors hover:bg-bg-hover">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle>{project.title}</CardTitle>
                      {project.latestSubmission ? (
                        <span className="shrink-0 text-xs text-fg-muted">
                          {STATUS_LABEL[project.latestSubmission.status] ?? project.latestSubmission.status}
                        </span>
                      ) : null}
                    </div>
                    <CardDescription>{project.brief}</CardDescription>
                  </CardHeader>
                  {project.latestSubmission?.defenseScore != null ? (
                    <CardContent>
                      <p className="text-xs text-fg-muted">
                        Оценка защиты: {Math.round(project.latestSubmission.defenseScore * 100)}%
                      </p>
                    </CardContent>
                  ) : null}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
