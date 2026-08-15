'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';

import { submitProject } from '@/features/projects/actions';

type ExistingSubmission = { id: string; status: string; defenseScore: number | null } | null;

export function SubmitForm({
  projectId,
  existingSubmission,
}: {
  projectId: string;
  existingSubmission: ExistingSubmission;
}) {
  const router = useRouter();
  const [artifactUrl, setArtifactUrl] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (existingSubmission && existingSubmission.status !== 'revisions_requested') {
    return (
      <div className="rounded-card border border-border p-5 text-sm text-fg-muted">
        <p>Сдача уже отправлена. Статус: {existingSubmission.status}.</p>
        {existingSubmission.status === 'submitted' || existingSubmission.status === 'in_defense' ? (
          <Button
            className="mt-3"
            onClick={() => router.push(`/projects/submissions/${existingSubmission.id}/defense`)}
          >
            Перейти к защите
          </Button>
        ) : null}
      </div>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!artifactUrl.trim() && !content.trim()) {
      setError('Укажите ссылку на артефакт или текст решения.');
      return;
    }

    setPending(true);
    const result = await submitProject({
      projectId,
      artifactUrl: artifactUrl.trim() || undefined,
      content: content.trim() || undefined,
    });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/projects/submissions/${result.data.submissionId}/defense`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-card border border-border p-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="artifactUrl">Ссылка на артефакт</Label>
        <Input
          id="artifactUrl"
          type="url"
          placeholder="https://github.com/…"
          value={artifactUrl}
          onChange={(e) => setArtifactUrl(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="content">Или текст решения</Label>
        <Textarea
          id="content"
          rows={8}
          placeholder="Опишите решение или вставьте код/текст артефакта"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Отправка…' : 'Сдать на защиту'}
      </Button>
    </form>
  );
}
