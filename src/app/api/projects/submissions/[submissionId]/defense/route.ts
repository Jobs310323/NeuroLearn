import { convertToModelMessages, type UIMessage } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { buildDefenseSystemPrompt, streamDefenseReply } from '@/lib/ai/agents/defense-coach';
import { ensureConversation, persistTurn } from '@/lib/ai/agents/tutor';
import { AiNotConfiguredError } from '@/lib/ai/provider';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { loadSubmissionForDefense, setDefenseConversationId } from '@/lib/db/queries/projects';
import { checkRateLimit } from '@/lib/security/rate-limit';

/**
 * Стриминг диалога защиты — `docs/API.md` §7, по образцу `tutor/chat/route.ts`.
 * Персистентность переиспользует `tutor_conversations`/`tutor_messages`
 * (см. комментарий у `project_submissions.defenseConversationId` в схеме) —
 * отдельных таблиц под диалог защиты не заводится.
 */

const bodySchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
    }
    throw error;
  }

  // Диалоговый роут — окно по умолчанию, как у `tutor/chat`.
  const rateLimit = await checkRateLimit(`project-defense:${userId}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Слишком много запросов, подождите немного.' } },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const { submissionId } = await params;
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' } }, { status: 400 });
  }

  const submission = await loadSubmissionForDefense(userId, submissionId);
  if (!submission) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Сдача не найдена.' } }, { status: 404 });
  }

  const conversation = await ensureConversation({
    userId,
    conversationId: submission.defenseConversationId ?? undefined,
    nodeId: submission.nodeId,
  });
  if (!submission.defenseConversationId) {
    await setDefenseConversationId(submissionId, conversation.id);
  }

  const uiMessages = parsed.data.messages as unknown as UIMessage[];
  const userText = extractText(uiMessages[uiMessages.length - 1]);
  const modelMessages = await convertToModelMessages(uiMessages);

  let result: ReturnType<typeof streamDefenseReply>;
  try {
    result = streamDefenseReply({
      system: buildDefenseSystemPrompt({
        projectTitle: submission.title,
        projectBrief: submission.brief,
        criteria: submission.criteria,
        artifactSummary: submission.artifactSummary,
      }),
      messages: modelMessages,
      criteria: submission.criteria,
    });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: { code: 'AI_NOT_CONFIGURED', message: error.message } }, { status: 503 });
    }
    throw error;
  }

  return result.toUIMessageStreamResponse({
    originalMessages: uiMessages,
    onEnd: async ({ messages }) => {
      const assistantMessage = messages[messages.length - 1];
      const assistantText =
        assistantMessage?.role === 'assistant' ? extractDefenseQuestion(assistantMessage) : '';
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

function extractDefenseQuestion(message: UIMessage): string {
  for (const part of message.parts) {
    if (part.type !== 'tool-askDefenseQuestion') continue;
    if (part.state !== 'output-available') continue;
    const output = part.output as { accepted?: boolean; question?: string };
    if (!output?.accepted || !output.question) continue;
    return output.question;
  }
  return extractText(message);
}
