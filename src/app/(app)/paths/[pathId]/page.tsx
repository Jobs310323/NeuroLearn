import { notFound } from 'next/navigation';

import { requireUserId } from '@/lib/auth/require-user';
import { getPathGraph } from '@/lib/db/queries/paths';

import { PathWorkspace } from './path-workspace';

export default async function PathPage({
  params,
}: {
  params: Promise<{ pathId: string }>;
}) {
  const { pathId } = await params;
  const userId = await requireUserId();
  const graph = await getPathGraph(userId, pathId);
  if (!graph) notFound();

  return <PathWorkspace graph={graph} />;
}
