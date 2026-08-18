import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireUserId } from '@/lib/auth/require-user';
import { getNodeReadingMaterial } from '@/lib/db/queries/reading';

import { ContentBlockView } from './content-block';

export default async function NodeReadingPage({
  params,
}: {
  params: Promise<{ pathId: string; nodeId: string }>;
}) {
  const { pathId, nodeId } = await params;
  const userId = await requireUserId();
  const material = await getNodeReadingMaterial(userId, nodeId);
  if (!material || material.node.pathId !== pathId) notFound();

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <Link
        href={{ pathname: `/paths/${pathId}` }}
        className="inline-flex items-center gap-1.5 text-xs text-fg-subtle hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {material.node.pathTitle}
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{material.node.title}</h1>
      {material.node.description ? (
        <p className="mt-2 text-sm text-fg-muted">{material.node.description}</p>
      ) : null}

      <div className="mt-8 flex flex-col gap-6">
        {material.blocks.map((block) => (
          <ContentBlockView key={block.id} block={block} nodeId={nodeId} />
        ))}
      </div>
    </div>
  );
}
