import { notFound } from 'next/navigation';

import { requireUserId } from '@/lib/auth/require-user';
import { loadSubmissionForDefense } from '@/lib/db/queries/projects';

import { DefenseChat } from './defense-chat';

export default async function DefensePage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const userId = await requireUserId();
  const { submissionId } = await params;
  const submission = await loadSubmissionForDefense(userId, submissionId);
  if (!submission) notFound();

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Защита: {submission.title}</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Отвечайте по существу — ИИ задаёт вопросы по рубрике, а не проверяет код за вас.
        </p>
      </header>
      <DefenseChat
        submissionId={submissionId}
        criteria={submission.criteria}
        status={submission.status}
      />
    </div>
  );
}
