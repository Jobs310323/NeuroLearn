import { ScienceHint } from '@/components/science-hint';
import { requireUserId } from '@/lib/auth/require-user';
import { getReflections } from '@/lib/db/queries/reflections';

import { ReflectView } from './reflect-view';

export default async function ReflectPage({
  searchParams,
}: {
  searchParams: Promise<{ nodeId?: string }>;
}) {
  const userId = await requireUserId();
  const { nodeId } = await searchParams;
  const history = await getReflections(userId);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        Дневник обучения
        <ScienceHint citation="metacognition" />
      </h1>
      <p className="mt-1 text-sm text-fg-muted">
        Узел не переходит в статус «освоен» без записи в дневнике: отслеживание
        собственного понимания — отдельный навык, а не формальность.
      </p>

      <ReflectView initialHistory={history} initialNodeId={nodeId ?? null} />
    </div>
  );
}
