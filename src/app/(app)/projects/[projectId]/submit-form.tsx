'use client';

import { Loader2, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';

import { submitProject } from '@/features/projects/actions';
import { runInSandbox } from '@/features/projects/sandbox/webcontainer-runner';

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
  const [sandboxRunning, setSandboxRunning] = useState(false);
  const [sandboxOutput, setSandboxOutput] = useState<string | null>(null);

  async function runSandbox() {
    setSandboxRunning(true);
    setSandboxOutput(null);
    const result = await runInSandbox(content);
    setSandboxRunning(false);
    setSandboxOutput(
      result.ran
        ? `Код выполнен (exit ${result.exitCode}):\n${result.output || '(пустой вывод)'}`
        : `Не удалось выполнить: ${result.error}`,
    );
  }

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

    const contentWithSandbox = (
      sandboxOutput ? `${content.trim()}\n\n--- Вывод песочницы ---\n${sandboxOutput}` : content.trim()
    ).slice(0, 20000);

    setPending(true);
    const result = await submitProject({
      projectId,
      artifactUrl: artifactUrl.trim() || undefined,
      content: contentWithSandbox || undefined,
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
          onChange={(e) => {
            setContent(e.target.value);
            setSandboxOutput(null);
          }}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="w-fit text-xs"
            disabled={!content.trim() || sandboxRunning}
            onClick={() => void runSandbox()}
          >
            {sandboxRunning ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
            Запустить как Node.js-код
          </Button>
          <span className="text-xs text-fg-subtle">
            Если решение — код на JS/TS: запускается в браузере (WebContainer), вывод прикладывается к
            сдаче.
          </span>
        </div>
        {sandboxOutput ? (
          <pre className="max-h-48 overflow-auto rounded-md bg-bg-hover p-3 text-xs whitespace-pre-wrap">
            {sandboxOutput}
          </pre>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Отправка…' : 'Сдать на защиту'}
      </Button>
    </form>
  );
}
