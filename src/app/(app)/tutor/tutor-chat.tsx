'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { MessageCirclePlus, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ConversationSummary = {
  id: string;
  title: string;
  nodeId: string | null;
  updatedAt: string;
  lastMessage: { role: string; content: string } | null;
};

type SocraticOutput = { accepted: boolean; question?: string; walkthrough?: string; reason?: string };

export function TutorChat({
  initialNodeId,
  initialConversationId,
}: {
  initialNodeId: string | null;
  initialConversationId: string | null;
}) {
  const [nodeId] = useState(initialNodeId);
  const [selectedId, setSelectedId] = useState(initialConversationId);
  /**
   * Drives remounting `ChatPanel`. Deliberately NOT the same state as
   * `selectedId`: once a turn starts, `ChatBody` reports its own freshly
   * minted conversation id back up via `onConversationStart` purely so the
   * sidebar can highlight it — remounting on that would tear down the
   * in-flight `useChat` instance and abort the streaming request.
   */
  const [sessionKey, setSessionKey] = useState(() => initialConversationId ?? `new-${initialNodeId ?? 'none'}`);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  async function refreshConversations() {
    const response = await fetch('/api/tutor/conversations');
    if (!response.ok) return;
    const data = (await response.json()) as { conversations: ConversationSummary[] };
    setConversations(data.conversations);
  }

  useEffect(() => {
    void refreshConversations();
  }, []);

  return (
    <>
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-elevated/40">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <h2 className="text-sm font-medium text-fg">Тьютор</h2>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Новый диалог"
            onClick={() => {
              setSelectedId(null);
              setSessionKey(`new-${crypto.randomUUID()}`);
            }}
          >
            <MessageCirclePlus aria-hidden />
          </Button>
        </div>
        <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="p-2 text-xs text-fg-subtle">Диалогов пока нет.</p>
          ) : null}
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(conversation.id);
                  setSessionKey(conversation.id);
                }}
                className={cn(
                  'w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-bg-hover',
                  conversation.id === selectedId ? 'bg-bg-hover text-fg' : 'text-fg-muted',
                )}
              >
                <p className="truncate font-medium">{conversation.title}</p>
                {conversation.lastMessage ? (
                  <p className="mt-0.5 truncate text-fg-subtle">{conversation.lastMessage.content}</p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <ChatPanel
        key={sessionKey}
        conversationId={selectedId}
        nodeId={nodeId}
        onConversationStart={(id) => {
          setSelectedId(id);
          void refreshConversations();
        }}
        onTurnFinished={() => void refreshConversations()}
      />
    </>
  );
}

function ChatPanel({
  conversationId,
  nodeId,
  onConversationStart,
  onTurnFinished,
}: {
  conversationId: string | null;
  nodeId: string | null;
  onConversationStart: (id: string) => void;
  onTurnFinished: () => void;
}) {
  /**
   * Captured once at mount. `ChatPanel` only remounts (new `key` upstream)
   * when the user explicitly switches conversations, so re-reading the prop
   * here would refetch — and briefly unmount `ChatBody` — every time
   * `ChatBody` reports its own newly created conversation id upward.
   */
  const [targetId] = useState(conversationId);
  const [ready, setReady] = useState(!targetId);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    fetch(`/api/tutor/conversations/${targetId}`)
      .then((response) => (response.ok ? response.json() : { messages: [] }))
      .then((data: { messages: UIMessage[] }) => {
        if (cancelled) return;
        setInitialMessages(data.messages ?? []);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  if (!ready) {
    return <div className="flex flex-1 items-center justify-center text-sm text-fg-subtle">Загрузка…</div>;
  }

  return (
    <ChatBody
      conversationId={conversationId}
      nodeId={nodeId}
      initialMessages={initialMessages}
      onConversationStart={onConversationStart}
      onTurnFinished={onTurnFinished}
    />
  );
}

function ChatBody({
  conversationId,
  nodeId,
  initialMessages,
  onConversationStart,
  onTurnFinished,
}: {
  conversationId: string | null;
  nodeId: string | null;
  initialMessages: UIMessage[];
  onConversationStart: (id: string) => void;
  onTurnFinished: () => void;
}) {
  const [id] = useState(() => conversationId ?? crypto.randomUUID());
  const [input, setInput] = useState('');

  const { messages, sendMessage, status, error } = useChat({
    id,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/tutor/chat',
      body: { conversationId: id, nodeId: nodeId ?? undefined },
    }),
    onFinish: () => onTurnFinished(),
  });

  const busy = status === 'submitted' || status === 'streaming';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (!conversationId) onConversationStart(id);
    void sendMessage({ text });
    setInput('');
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            Опишите, что не получается. Тьютор задаёт наводящие вопросы вместо готовых ответов —
            это часть метода.
          </p>
        ) : null}

        <ul className="flex flex-col gap-4">
          {messages.map((message) => (
            <li
              key={message.id}
              className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[70%] whitespace-pre-wrap rounded-card px-4 py-2.5 text-sm',
                  message.role === 'user'
                    ? 'bg-accent text-accent-fg'
                    : 'border border-border bg-bg-elevated text-fg',
                )}
              >
                {renderMessageContent(message) ?? <span className="text-fg-subtle">…</span>}
              </div>
            </li>
          ))}
        </ul>

        {error ? <p className="mt-4 text-sm text-red-400">{error.message}</p> : null}
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-border p-4">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit(event);
            }
          }}
          rows={2}
          placeholder="Что не получается?"
          disabled={busy}
          className="flex-1 resize-none"
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Отправить">
          <Send aria-hidden />
        </Button>
      </form>
    </div>
  );
}

function renderMessageContent(message: UIMessage): string | null {
  for (const part of message.parts) {
    if (part.type !== 'tool-socraticMethod') continue;
    if (part.state !== 'output-available') continue;
    const output = part.output as SocraticOutput;
    if (!output.accepted || !output.question) continue;
    return output.walkthrough ? `${output.question}\n\n${output.walkthrough}` : output.question;
  }

  const text = message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

  return text || null;
}
