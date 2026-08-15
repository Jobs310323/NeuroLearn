import { requireUserId } from '@/lib/auth/require-user';

import { TutorChat } from './tutor-chat';

export default async function TutorPage({
  searchParams,
}: {
  searchParams: Promise<{ nodeId?: string; conversationId?: string }>;
}) {
  await requireUserId();
  const { nodeId, conversationId } = await searchParams;

  return (
    <div className="flex h-dvh min-w-0 flex-1">
      <TutorChat initialNodeId={nodeId ?? null} initialConversationId={conversationId ?? null} />
    </div>
  );
}
