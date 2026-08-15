'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { finalizeDefense } from '@/features/projects/actions';

type Criterion = { id: string; label: string; weight: number; levels: string[] };
type DefenseOutput = { accepted: boolean; criterionId?: string; question?: string; reason?: string };

export function DefenseChat({
  submissionId,
  criteria,
  status,
}: {
  submissionId: string;
  criteria: Criterion[];
  status: string;
}) {
  const { messages, sendMessage, status: chatStatus, error } = useChat({
    id: submissionId,
    transport: new DefaultChatTransport({ api: `/api/projects/submissions/${submissionId}/defense` }),
  });
  const [input, setInput] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [result, setResult] = useState<{ defenseScore: number } | { error: string } | null>(null);

  const busy = chatStatus === 'submitted' || chatStatus === 'streaming';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    void sendMessage({ text });
    setInput('');
  }

  async function onFinalize() {
    setFinalizing(true);
    const outcome = await finalizeDefense(submissionId);
    setFinalizing(false);
    setResult(outcome.ok ? outcome.data : { error: outcome.error });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            Опишите свой артефакт своими словами или сразу ответьте на первый вопрос — коуч начнёт
            с критериев рубрики: {criteria.map((c) => c.label).join(', ')}.
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

        {result ? (
          <div className="mt-4 rounded-card border border-border p-4 text-sm">
            {'error' in result ? (
              <p className="text-red-400">{result.error}</p>
            ) : (
              <p>
                Оценка защиты: <strong>{Math.round(result.defenseScore * 100)}%</strong>.{' '}
                {result.defenseScore >= 0.6
                  ? 'Проект принят.'
                  : 'Нужны доработки — слабые критерии вернули соответствующие узлы в практику.'}
              </p>
            )}
          </div>
        ) : null}
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
          placeholder="Ваш ответ"
          disabled={busy}
          className="flex-1 resize-none"
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Отправить">
          <Send aria-hidden />
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onFinalize}
          disabled={finalizing || busy || messages.length === 0 || status === 'accepted'}
        >
          {finalizing ? 'Считаю…' : 'Завершить защиту'}
        </Button>
      </form>
    </div>
  );
}

function renderMessageContent(message: UIMessage): string | null {
  for (const part of message.parts) {
    if (part.type !== 'tool-askDefenseQuestion') continue;
    if (part.state !== 'output-available') continue;
    const output = part.output as DefenseOutput;
    if (!output.accepted || !output.question) continue;
    return output.question;
  }

  const text = message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

  return text || null;
}
