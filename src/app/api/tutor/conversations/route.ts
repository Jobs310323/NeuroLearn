import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { tutorConversations, tutorMessages } from '@/lib/db/schema';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';

/** Список диалогов с превью последнего сообщения. Контракт — docs/API.md §5. */

export async function GET(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const nodeId = new URL(request.url).searchParams.get('nodeId');

  const conversations = await db.query.tutorConversations.findMany({
    where: nodeId
      ? (fields, { and, eq: eqOp }) => and(eqOp(fields.userId, userId), eqOp(fields.nodeId, nodeId))
      : (fields, { eq: eqOp }) => eqOp(fields.userId, userId),
    orderBy: [desc(tutorConversations.updatedAt)],
    limit: 50,
  });

  const previews = await Promise.all(
    conversations.map(async (conversation) => {
      const last = await db.query.tutorMessages.findFirst({
        where: eq(tutorMessages.conversationId, conversation.id),
        orderBy: [desc(tutorMessages.createdAt)],
        columns: { content: true, role: true, createdAt: true },
      });
      return {
        id: conversation.id,
        title: conversation.title,
        nodeId: conversation.nodeId,
        pathId: conversation.pathId,
        messageCount: conversation.messageCount,
        updatedAt: conversation.updatedAt,
        lastMessage: last ? { role: last.role, content: last.content, createdAt: last.createdAt } : null,
      };
    }),
  );

  return NextResponse.json({ conversations: previews });
}
