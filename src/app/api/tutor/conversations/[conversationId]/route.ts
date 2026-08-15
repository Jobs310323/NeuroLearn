import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { tutorConversations, tutorMessages } from '@/lib/db/schema';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';

/** История сообщений диалога, в формате UIMessage для инициализации useChat. */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const { conversationId } = await params;

  const conversation = await db.query.tutorConversations.findFirst({
    where: and(eq(tutorConversations.id, conversationId), eq(tutorConversations.userId, userId)),
  });
  if (!conversation) {
    return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });
  }

  const rows = await db
    .select({ id: tutorMessages.id, role: tutorMessages.role, content: tutorMessages.content })
    .from(tutorMessages)
    .where(eq(tutorMessages.conversationId, conversationId))
    .orderBy(asc(tutorMessages.createdAt));

  const messages = rows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({
      id: row.id,
      role: row.role as 'user' | 'assistant',
      parts: [{ type: 'text' as const, text: row.content }],
    }));

  return NextResponse.json({ conversation: { id: conversation.id, nodeId: conversation.nodeId }, messages });
}
