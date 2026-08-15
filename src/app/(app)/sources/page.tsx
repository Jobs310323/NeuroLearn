import { requireUserId } from '@/lib/auth/require-user';
import { listPaths } from '@/lib/db/queries/paths';
import { listSources } from '@/lib/db/queries/sources';

import { SourceList } from './source-list';
import { UploadForm } from './upload-form';

export default async function SourcesPage() {
  const userId = await requireUserId();
  const [sources, paths] = await Promise.all([listSources(userId), listPaths(userId)]);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Источники</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Свои конспекты, книги и PDF. Текст извлекается и режется на фрагменты — файл не хранится.
        Генератор модулей опирается на них вместо общих знаний модели.
      </p>

      <UploadForm
        className="mt-8"
        paths={paths.map((p) => ({ id: p.id, title: p.title }))}
      />

      <h2 className="mt-10 text-sm font-medium text-fg-muted">
        {sources.length > 0 ? `Загружено: ${sources.length}` : 'Пока ничего не загружено'}
      </h2>
      <SourceList
        className="mt-3"
        sources={sources}
        paths={paths.map((p) => ({ id: p.id, title: p.title }))}
      />
    </div>
  );
}
