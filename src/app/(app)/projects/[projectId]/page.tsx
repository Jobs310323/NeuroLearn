import { notFound } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUserId } from '@/lib/auth/require-user';
import { getProjectDetail } from '@/lib/db/queries/projects';

import { SubmitForm } from './submit-form';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const userId = await requireUserId();
  const { projectId } = await params;
  const project = await getProjectDetail(userId, projectId);
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
      <p className="mt-2 text-sm text-fg-muted">{project.brief}</p>
      {project.estimatedHours ? (
        <p className="mt-1 text-xs text-fg-subtle">Оценка времени: ~{project.estimatedHours} ч.</p>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Рубрика защиты</CardTitle>
          <CardDescription>
            На защите ИИ задаёт вопросы по каждому критерию — решение за вас никто не пишет.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm text-fg-muted">
            {project.rubric.criteria.map((criterion) => (
              <li key={criterion.id}>
                <span className="font-medium text-fg">{criterion.label}</span>
                {' — '}
                {criterion.levels.join(' / ')}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="mt-8">
        <SubmitForm projectId={project.id} existingSubmission={project.submission} />
      </div>
    </div>
  );
}
