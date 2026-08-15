'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import type { AssessmentPayload, UserResponsePayload } from '@/lib/db/schema/types';
import { cn } from '@/lib/utils';

import { ReflectionJournal } from './reflection-journal';

type PracticeItem = {
  assessmentId: string;
  nodeId: string;
  nodeTitle: string;
  type: string;
  cognitiveLevel: string;
  prompt: string;
  payload: AssessmentPayload;
  feedbackMode: 'instant' | 'delayed';
  targetResponseMs: number | null;
  interleaved: boolean;
};

type RevealResult = {
  revealed: true;
  isCorrect: boolean;
  partialScore: number;
  explanation: string | null;
  socraticHints: string[];
  citationKey: string;
};

type RecordedResult = { revealed: false; recorded: true; hint: string };

type SessionSummary = {
  score: number;
  durationMs: number;
  results: { assessmentId: string; isCorrect: boolean; partialScore: number; explanation: string | null }[];
  nodeUpdates: {
    nodeId: string;
    statusBefore: string;
    statusAfter: string;
    knowledgeStrength: number;
    automaticityIndex: number;
  }[];
  reflectionRequired: { nodeId: string; prompts: string[] } | null;
  calibrationSummary: { meanConfidence: number; accuracy: number; gap: number } | null;
};

const STATUS_LABEL: Record<string, string> = {
  not_started: 'не начат',
  in_progress: 'в процессе',
  mastered: 'освоен',
  automated: 'автоматизм',
  has_gaps: 'есть пробелы',
  needs_review: 'нужно повторить',
};

export function PracticeRunner({
  nodeId,
  mode,
  mix,
  onDone,
}: {
  nodeId: string;
  mode: 'focused' | 'interleaved' | 'review';
  mix: boolean;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'loading' | 'answering' | 'summary' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PracticeItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState<UserResponsePayload | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [reveal, setReveal] = useState<RevealResult | RecordedResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [showJournal, setShowJournal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const nextParams = new URLSearchParams({
          nodeId,
          mode,
          mix: String(mix),
          limit: '10',
        });
        const nextRes = await fetch(`/api/practice/next?${nextParams}`);
        const nextBody = await nextRes.json();
        if (!nextRes.ok) throw new Error(nextBody.error?.message ?? 'Не удалось подобрать задания');

        const sessionRes = await fetch('/api/practice/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionDraftId: nextBody.sessionDraftId }),
        });
        const sessionBody = await sessionRes.json();
        if (!sessionRes.ok) throw new Error(sessionBody.error?.message ?? 'Не удалось начать сессию');

        if (cancelled) return;
        const orderedItems = sessionBody.itemOrder
          .map((id: string) => nextBody.items.find((item: PracticeItem) => item.assessmentId === id))
          .filter(Boolean) as PracticeItem[];

        setItems(orderedItems);
        setSessionId(sessionBody.sessionId);
        setStartedAt(Date.now());
        setPhase('answering');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не удалось начать практику');
          setPhase('error');
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, [nodeId, mode, mix]);

  const current = items[index];

  async function submit() {
    if (!sessionId || !current || !response || confidence == null) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/practice/sessions/${sessionId}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: current.assessmentId,
          response,
          responseTimeMs: Date.now() - startedAt,
          confidenceLevel: confidence,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Не удалось отправить ответ');
      setReveal(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сеть недоступна');
    } finally {
      setSubmitting(false);
    }
  }

  async function advance() {
    if (index + 1 < items.length) {
      setIndex(index + 1);
      setResponse(null);
      setConfidence(null);
      setReveal(null);
      setStartedAt(Date.now());
      return;
    }
    if (!sessionId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/practice/sessions/${sessionId}/complete`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Не удалось завершить сессию');
      setSummary(body);
      setPhase('summary');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сеть недоступна');
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="mt-8 flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Подбираю задания…
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Не получилось начать практику</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-fg-muted">
          <p>{error}</p>
          <Button size="sm" variant="secondary" className="self-start" onClick={onDone}>
            Назад к очереди
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === 'summary' && summary) {
    return (
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Сессия завершена</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-fg">
            Точность: <span className="font-medium tabular-nums">{Math.round(summary.score * 100)}%</span>
          </p>

          <ul className="flex flex-col gap-1.5">
            {summary.nodeUpdates.map((u) => (
              <li key={u.nodeId} className="flex items-center justify-between text-xs text-fg-muted">
                <span>Прочность знания</span>
                <span className="tabular-nums text-fg">
                  {u.knowledgeStrength}/100
                  {u.statusBefore !== u.statusAfter
                    ? ` · ${STATUS_LABEL[u.statusBefore] ?? u.statusBefore} → ${STATUS_LABEL[u.statusAfter] ?? u.statusAfter}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>

          {summary.calibrationSummary ? (
            <p className="text-xs text-fg-subtle">
              Уверенность в среднем {Math.round(summary.calibrationSummary.meanConfidence * 100)}%, точность{' '}
              {Math.round(summary.calibrationSummary.accuracy * 100)}%
              {summary.calibrationSummary.gap > 0.15 ? ' — заметная переоценка себя.' : '.'}
            </p>
          ) : null}

          {summary.reflectionRequired && !showJournal ? (
            <div className="rounded-md border border-border bg-bg p-3 text-xs text-fg-muted">
              <p className="mb-2">
                Узел близок к «освоен»: не хватает записи в дневнике рефлексии.
              </p>
              <Button size="sm" onClick={() => setShowJournal(true)}>
                Написать рефлексию
              </Button>
            </div>
          ) : null}

          {summary.reflectionRequired && showJournal ? (
            <ReflectionJournal
              nodeId={summary.reflectionRequired.nodeId}
              sessionId={sessionId}
              onDone={() => setShowJournal(false)}
            />
          ) : null}

          <Button size="sm" className="self-start" onClick={onDone}>
            Назад к очереди
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!current) return null;

  return (
    <Card className="mt-8">
      <CardHeader>
        <div className="flex items-center justify-between text-xs text-fg-subtle">
          <span>{current.nodeTitle}</span>
          <span>
            {index + 1} / {items.length}
          </span>
        </div>
        <CardTitle className="text-base font-normal leading-snug text-fg">{current.prompt}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!reveal ? (
          <>
            <AssessmentInput payload={current.payload} value={response} onChange={setResponse} />

            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-fg-subtle">Насколько ты уверен(а) в ответе?</p>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setConfidence(level)}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md border text-xs tabular-nums transition-colors',
                      confidence === level
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-border bg-bg text-fg-muted hover:bg-bg-hover',
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {error ? <p className="text-xs text-red-400">{error}</p> : null}

            <Button
              size="sm"
              className="self-start"
              disabled={submitting || !response || confidence == null}
              onClick={() => void submit()}
            >
              Ответить
            </Button>
          </>
        ) : (
          <>
            {reveal.revealed ? (
              <div className="flex flex-col gap-2">
                <p className={cn('text-sm font-medium', reveal.isCorrect ? 'text-green-500' : 'text-amber-500')}>
                  {reveal.isCorrect ? 'Верно' : 'Не совсем'}
                </p>
                {reveal.explanation ? <p className="text-sm text-fg-muted">{reveal.explanation}</p> : null}
                {!reveal.isCorrect && reveal.socraticHints.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-xs text-fg-subtle">
                    {reveal.socraticHints.map((hint, i) => (
                      <li key={i}>— {hint}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-fg-muted">{reveal.hint}</p>
            )}

            <Button size="sm" className="self-start" disabled={submitting} onClick={() => void advance()}>
              {index + 1 < items.length ? 'Далее' : 'Завершить'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AssessmentInput({
  payload,
  value,
  onChange,
}: {
  payload: AssessmentPayload;
  value: UserResponsePayload | null;
  onChange: (value: UserResponsePayload) => void;
}) {
  if (payload.kind === 'mcq') {
    const selected = value?.kind === 'option_ids' ? value.ids[0] : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        {payload.options.map((option) => (
          <label
            key={option.id}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm transition-colors',
              selected === option.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg-hover',
            )}
          >
            <input
              type="radio"
              name="mcq"
              className="accent-[var(--color-accent)]"
              checked={selected === option.id}
              onChange={() => onChange({ kind: 'option_ids', ids: [option.id] })}
            />
            {option.text}
          </label>
        ))}
      </div>
    );
  }

  if (payload.kind === 'multi_select') {
    const selected = value?.kind === 'option_ids' ? value.ids : [];
    return (
      <div className="flex flex-col gap-1.5">
        {payload.options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label
              key={option.id}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm transition-colors',
                checked ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg-hover',
              )}
            >
              <input
                type="checkbox"
                className="accent-[var(--color-accent)]"
                checked={checked}
                onChange={() =>
                  onChange({
                    kind: 'option_ids',
                    ids: checked ? selected.filter((id) => id !== option.id) : [...selected, option.id],
                  })
                }
              />
              {option.text}
            </label>
          );
        })}
      </div>
    );
  }

  if (payload.kind === 'cloze') {
    const text = value?.kind === 'blanks' ? (value.byBlankId.b1 ?? '') : '';
    return (
      <Textarea
        rows={2}
        placeholder="Впишите пропущенное"
        value={text}
        onChange={(e) => onChange({ kind: 'blanks', byBlankId: { b1: e.target.value } })}
      />
    );
  }

  // short_answer, free_recall, case_study — свободный текстовый ответ.
  const text = value?.kind === 'text' ? value.value : '';
  return (
    <Textarea
      rows={4}
      placeholder="Ваш ответ"
      value={text}
      onChange={(e) => onChange({ kind: 'text', value: e.target.value })}
    />
  );
}
