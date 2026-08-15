import { ScienceHint } from '@/components/science-hint';
import { getReviewQueue } from '@/lib/db/queries/review';
import { requireUserId } from '@/lib/auth/require-user';

import { ReviewQueueView } from './review-queue';

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ nodeId?: string }>;
}) {
  const userId = await requireUserId();
  const { nodeId } = await searchParams;
  const queue = await getReviewQueue(userId, { limit: 30, horizon: 'week' });

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        Очередь повторений
        <ScienceHint citation="fsrs" />
      </h1>
      <p className="mt-1 text-sm text-fg-muted">
        Интервалы считает FSRS: повторение назначается на момент, когда вероятность
        вспомнить падает до целевого уровня.
      </p>

      <ReviewQueueView initialQueue={queue} initialNodeId={nodeId ?? null} />
    </div>
  );
}
