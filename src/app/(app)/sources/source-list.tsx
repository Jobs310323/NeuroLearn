'use client';

import { FileText, Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { attachSourceToPath, deleteSource } from '@/features/sources/actions';
import { cn } from '@/lib/utils';
import type { SourceSummary } from '@/lib/db/queries/sources';

const KIND_LABEL: Record<string, string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
  plain_text: 'Текст',
  ai_notes: 'Вставленный текст',
  url: 'Ссылка',
  epub: 'EPUB',
};

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'загружен',
  extracting: 'обрабатывается…',
  ready: 'готов',
  failed: 'ошибка',
};

export function SourceList({
  sources,
  paths,
  className,
}: {
  sources: SourceSummary[];
  paths: { id: string; title: string }[];
  className?: string;
}) {
  if (sources.length === 0) return null;

  return (
    <ul className={cn('flex flex-col gap-3', className)}>
      {sources.map((source) => (
        <li key={source.id}>
          <SourceCard source={source} paths={paths} />
        </li>
      ))}
    </ul>
  );
}

function SourceCard({
  source,
  paths,
}: {
  source: SourceSummary;
  paths: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onDelete() {
    setPending(true);
    await deleteSource({ documentId: source.id });
    router.refresh();
  }

  async function onAttach(pathId: string) {
    setPending(true);
    await attachSourceToPath({ documentId: source.id, pathId: pathId || null });
    router.refresh();
    setPending(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-fg-subtle" aria-hidden />
            <CardTitle>{source.title}</CardTitle>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => void onDelete()}
            className="shrink-0 text-fg-subtle hover:text-red-400"
            aria-label="Удалить источник"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs text-fg-subtle">
        <div className="flex items-center gap-2">
          <span>{KIND_LABEL[source.kind] ?? source.kind}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            {source.status === 'extracting' ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : source.status === 'failed' ? (
              <TriangleAlert className="size-3 text-red-400" aria-hidden />
            ) : null}
            {STATUS_LABEL[source.status] ?? source.status}
          </span>
          {source.status === 'ready' ? (
            <>
              <span>·</span>
              <span>{source.chunkCount} фрагментов</span>
            </>
          ) : null}
        </div>

        {source.failureReason ? (
          <p className="text-red-400">{source.failureReason}</p>
        ) : null}

        <div className="flex items-center gap-2">
          <label className="text-fg-subtle" htmlFor={`path-${source.id}`}>
            Путь:
          </label>
          <select
            id={`path-${source.id}`}
            disabled={pending}
            defaultValue={source.pathId ?? ''}
            onChange={(e) => void onAttach(e.target.value)}
            className="h-7 rounded-md border border-border bg-bg px-2 text-xs text-fg"
          >
            <option value="">Не привязан</option>
            {paths.map((path) => (
              <option key={path.id} value={path.id}>
                {path.title}
              </option>
            ))}
          </select>
        </div>
      </CardContent>
    </Card>
  );
}
