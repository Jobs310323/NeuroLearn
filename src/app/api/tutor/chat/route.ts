import { convertToModelMessages, type UIMessage } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  buildTutorSystemPrompt,
  ensureConversation,
  persistTurn,
  streamTutorReply,
} from '@/lib/ai/agents/tutor';
import { AiNotConfiguredError } from '@/lib/ai/provider';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';

/**
 * Стриминг ответа тьютора. Контракт — docs/API.md §5.
 *
 * userId берётся только из сессии, не из тела запроса.
 */

const bodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  nodeId: z.string().uuid().optional(),
  messages: z.array(z.record(z.string(), z.unknown())).min(1),
});

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }

  const nodeId = parsed.data.nodeId ?? null;
  const uiMessages = parsed.data.messages as unknown as UIMessage[];

  const conversation = await ensureConversation({
    userId,
    conversationId: parsed.data.conversationId,
    nodeId,
  });

  let system: string;
  try {
    system = await buildTutorSystemPrompt({
      userId,
      nodeId,
      memorySummary: conversation.memorySummary,
    });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  const userText = extractText(uiMessages[uiMessages.length - 1]);
  const modelMessages = await convertToModelMessages(uiMessages);

  const result = streamTutorReply({
    system,
    messages: modelMessages,
    context: {
      userId,
      conversationId: conversation.id,
      nodeId,
      socraticDepth: conversation.socraticDepth,
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: uiMessages,
    onEnd: async ({ messages }) => {
      const assistantMessage = messages[messages.length - 1];
      const assistantText =
        assistantMessage?.role === 'assistant' ? extractSocraticReply(assistantMessage) : '';
      if (userText && assistantText) {
        await persistTurn({
          conversationId: conversation.id,
          userMessage: userText,
          assistantMessage: assistantText,
          socraticDepth: conversation.socraticDepth,
        });
      }
    },
  });
}

function extractText(message: UIMessage | undefined): string {
  if (!message) return '';
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/** Реплика тьютора живёт в аргументах инструмента SocraticMethod, не в обычном тексте. */
function extractSocraticReply(message: UIMessage): string {
  for (const part of message.parts) {
    if (part.type !== 'tool-socraticMethod') continue;
    if (part.state !== 'output-available') continue;
    const output = part.output as { question?: string; walkthrough?: string };
    if (!output?.question) continue;
    return output.walkthrough ? `${output.question}\n\n${output.walkthrough}` : output.question;
  }
  return extractText(message);
}
