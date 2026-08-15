import Link from 'next/link';

import { requireUserId } from '@/lib/auth/require-user';
import { getAnalyticsOverview } from '@/lib/db/queries/analytics';
import { listPaths } from '@/lib/db/queries/paths';

import { AnalyticsDashboard } from './analytics-dashboard';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ pathId?: string }>;
}) {
  const userId = await requireUserId();
  const { pathId } = await searchParams;
  const [paths, data] = await Promise.all([listPaths(userId), getAnalyticsOverview(userId, pathId)]);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Аналитика</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Прогресс без очков и бейджей — прочность знаний, время до мастерства, эффект интерливинга.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/analytics"
          className={
            !pathId
              ? 'rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg'
              : 'rounded-full border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-hover'
          }
        >
          Все пути
        </Link>
        {paths.map((p) => (
          <Link
            key={p.id}
            href={`/analytics?pathId=${p.id}`}
            className={
              p.id === pathId
                ? 'rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg'
                : 'rounded-full border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-hover'
            }
          >
            {p.title}
          </Link>
        ))}
      </div>

      {data === null ? (
        <p className="mt-8 text-sm text-fg-subtle">Путь не найден.</p>
      ) : (
        <AnalyticsDashboard className="mt-8" data={data} />
      )}
    </div>
  );
}
