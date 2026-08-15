'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const MIN_BODY_LENGTH = 200;

type PromptsResponse = {
  prompts: string[];
  checklist: { id: string; label: string }[];
  context: { accuracy: number; calibrationGap: number | null; hardestAssessmentIds: string[] };
};

type SubmitResult = {
  coachFeedback: string | null;
  calibrationDelta: number | null;
  unlockedMastery: boolean;
};

export function ReflectionJournal({
  nodeId,
  sessionId,
  onDone,
}: {
  nodeId: string;
  sessionId: string | null;
  onDone: () => void;
}) {
  const [data, setData] = useState<PromptsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [perceivedMastery, setPerceivedMastery] = useState<number | null>(null);
  const [hardestPart, setHardestPart] = useState('');
  const [plannedNextStep, setPlannedNextStep] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reflections/prompts?nodeId=${nodeId}&type=post_module`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) {
          setLoadError(j.error.message ?? 'Не удалось загрузить вопросы');
          return;
        }
        setData(j);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Сеть недоступна');
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  async function submit() {
    if (perceivedMastery == null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/reflections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'post_module',
          nodeId,
          sessionId: sessionId ?? undefined,
          body,
          prompts: data?.prompts ?? [],
          selfAssessment: {
            perceivedMastery,
            hardestPart,
            plannedNextStep,
            checklist: (data?.checklist ?? []).map((c) => ({
              id: c.id,
              label: c.label,
              checked: Boolean(checked[c.id]),
            })),
          },
        }),
      });
      const bodyJson = await res.json();
      if (!res.ok) throw new Error(bodyJson.error?.message ?? 'Не удалось сохранить рефлексию');
      setResult(bodyJson);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Сеть недоступна');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Рефлексия сохранена</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {result.unlockedMastery ? (
            <p className="text-green-500">Узел перешёл в статус «освоен».</p>
          ) : null}
          {result.coachFeedback ? <p className="text-fg-muted">{result.coachFeedback}</p> : null}
          {result.calibrationDelta != null ? (
            <p className="text-xs text-fg-subtle">
              Разрыв калибровки: {result.calibrationDelta >= 0 ? '+' : ''}
              {Math.round(result.calibrationDelta * 100)}%
              {result.calibrationDelta > 0.15 ? ' — переоценка себя.' : ''}
            </p>
          ) : null}
          <Button size="sm" className="self-start" onClick={onDone}>
            Готово
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="mt-4">
        <CardContent className="flex flex-col gap-3 pt-4 text-sm text-fg-muted">
          <p>{loadError}</p>
          <Button size="sm" variant="secondary" className="self-start" onClick={onDone}>
            Позже
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Готовлю вопросы для дневника…
      </div>
    );
  }

  const canSubmit = perceivedMastery != null && body.trim().length >= MIN_BODY_LENGTH;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Дневник рефлексии</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <ul className="flex flex-col gap-1.5 text-fg-muted">
          {data.prompts.map((p, i) => (
            <li key={i}>— {p}</li>
          ))}
        </ul>

        <Textarea
          rows={6}
          placeholder="Ответь на вопросы выше своими словами (от 200 знаков)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="text-xs text-fg-subtle">{body.trim().length} / {MIN_BODY_LENGTH}</p>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-fg-subtle">Насколько ты освоил(а) узел, на твой взгляд?</p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setPerceivedMastery(level)}
                className={cn(
                  'flex size-8 items-center justify-center rounded-md border text-xs tabular-nums transition-colors',
                  perceivedMastery === level
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border bg-bg text-fg-muted hover:bg-bg-hover',
                )}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-fg-subtle" htmlFor="hardestPart">
            Что было сложнее всего?
          </label>
          <Textarea
            id="hardestPart"
            rows={2}
            value={hardestPart}
            onChange={(e) => setHardestPart(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-fg-subtle" htmlFor="plannedNextStep">
            Что сделаешь дальше?
          </label>
          <Textarea
            id="plannedNextStep"
            rows={2}
            value={plannedNextStep}
            onChange={(e) => setPlannedNextStep(e.target.value)}
          />
        </div>

        {data.checklist.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {data.checklist.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-2 text-fg-muted">
                  <input
                    type="checkbox"
                    className="accent-[var(--color-accent)]"
                    checked={Boolean(checked[item.id])}
                    onChange={() =>
                      setChecked((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                    }
                  />
                  {item.label}
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        {submitError ? <p className="text-xs text-red-400">{submitError}</p> : null}

        <div className="flex gap-2">
          <Button size="sm" disabled={!canSubmit || submitting} onClick={() => void submit()}>
            Сохранить
          </Button>
          <Button size="sm" variant="secondary" onClick={onDone}>
            Позже
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
