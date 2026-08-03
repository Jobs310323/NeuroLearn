import { ScienceHint } from '@/components/science-hint';

import { NewPathForm } from './new-path-form';

export default function NewPathPage() {
  return (
    <div className="mx-auto max-w-xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Новый путь обучения</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
        Цель определяет структуру дерева знаний и порядок практики.
        <ScienceHint citation="desirable_difficulties" />
      </p>

      <NewPathForm className="mt-8" />
    </div>
  );
}
