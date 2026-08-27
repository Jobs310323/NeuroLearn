import { NotebookWorkspace } from '@/features/notebook/components/notebook-workspace';
import { requireUserId } from '@/lib/auth/require-user';

export const metadata = { title: 'Рабочая тетрадь — NeuroLearn' };

/**
 * Рабочая тетрадь — второй слой карты знаний.
 *
 * Страница нарочно тонкая: данные тетради читаются через API, потому что тот
 * же путь используют офлайн-очередь и захват из практики. Один контракт на
 * всех вместо серверной выборки для экрана и отдельного API для остальных.
 */
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; nodeId?: string }>;
}) {
  await requireUserId();
  const params = await searchParams;

  return (
    <div className="flex h-dvh min-h-0 flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-medium">Рабочая тетрадь</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Практика строит навык, тетрадь строит понимание. Заметки живут на тех же узлах, что и
          практика, и возвращаются, когда знание под ними проседает.
        </p>
      </header>

      <NotebookWorkspace initialNoteId={params.note} initialNodeId={params.nodeId} />
    </div>
  );
}
