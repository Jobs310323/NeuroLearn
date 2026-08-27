'use client';

import { HelpCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { GlossaryTerm } from '@/components/glossary-term';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { HintCard } from '@/features/practice/components/hint-card';
import { RestTimer } from '@/features/practice/components/rest-timer';
import { useHints, type HintBootstrap } from '@/features/practice/hooks/use-hints';
import type { AssessmentPayload, UserResponsePayload } from '@/lib/db/schema/types';
import { useSwipe } from '@/lib/hooks/use-swipe';
import { bloomDifficulty } from '@/lib/practice/hints/config';
import type { Hint, HintOutcome, HintResponseSample } from '@/lib/practice/hints/types';
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
  blockType?: string | null;
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
  results: {
    assessmentId: string;
    nodeId: string;
    cognitiveLevel: string | null;
    isCorrect: boolean;
    partialScore: number;
    explanation: string | null;
  }[];
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

/** F8: продуктивная неудача — гипотеза до объяснения — включается на этих уровнях (PRD §3 п.4). */
const DEEP_LEVELS = new Set(['apply', 'analyze', 'evaluate', 'create']);

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
  /**
   * Judgment of Knowing — проспективная оценка, собирается ДО того, как
   * открывается поле ответа. `null`, пока не дана: это и есть переключатель
   * между шагом JOK и обычным вводом ответа для текущего задания.
   */
  const [jokLevel, setJokLevel] = useState<number | null>(null);
  const [response, setResponse] = useState<UserResponsePayload | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  /**
   * Ответ зафиксирован — таймер остановлен, дальше идёт отдельный шаг оценки
   * уверенности. Раньше шкала стояла на одном экране с ответом, и кнопка
   * «Ответить» была заблокирована, пока по ней не кликнут: в `responseTimeMs`
   * попадало время думания плюс время работы со шкалой. Для порога автоматизма
   * (единицы секунд) эта добавка сопоставима с самим сигналом.
   */
  const [committed, setCommitted] = useState<{ answerMs: number; at: number } | null>(null);
  const [reveal, setReveal] = useState<RevealResult | RecordedResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [showJournal, setShowJournal] = useState(false);

  const router = useRouter();
  /** Телеметрия сессии для движка подсказок. Копится на клиенте по ходу. */
  const [samples, setSamples] = useState<HintResponseSample[]>([]);
  const [hintBootstrap, setHintBootstrap] = useState<HintBootstrap | null>(null);
  const [resting, setResting] = useState<number | null>(null);
  /** Флаг «не понял» на текущем задании. Сбрасывается вместе с заданием. */
  const [confused, setConfused] = useState(false);

  const { hint, evaluate, resolve } = useHints({
    bootstrap: hintBootstrap,
    mode,
    sessionId,
  });

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        // `limit` не передаётся: без явного значения сервер сам решает,
        // сколько заданий предложить, по темпу пользователя и желаемой
        // длине сессии (`decidePolicy`, `services/practice/policy.ts`).
        const nextParams = new URLSearchParams({
          nodeId,
          mode,
          mix: String(mix),
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
        setHintBootstrap(nextBody.hints ?? null);
        // Таймер ответа стартует не здесь, а после шага JOK (`answerJok`):
        // время на саму оценку JOK не должно попадать в `responseTimeMs`.
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

  /**
   * Подсказка «перечитать перед практикой» — единственная, что считается ДО
   * первого задания (`currentIndex = -1`). Дальше пересчёт идёт только после
   * ответа: во время ввода подсказка сбивает, а не помогает.
   */
  useEffect(() => {
    if (!hintBootstrap || items.length === 0) return;
    evaluate({ responses: [], currentIndex: -1, nextCognitiveLevel: null });
    // Сознательно один раз за сессию: `evaluate` меняется при каждом ответе,
    // и без пустого списка зависимостей проверка «до начала» повторялась бы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintBootstrap, items.length]);

  /**
   * Проспективная оценка ДО попытки ответить. Запускает таймер ответа —
   * поэтому вызывается один раз за задание, до открытия поля ввода.
   */
  function answerJok(level: number) {
    if (jokLevel !== null) return;
    setJokLevel(level);
    setStartedAt(Date.now());
  }

  /** Останавливает таймер и открывает шаг уверенности. Сеть здесь не трогается. */
  function commitAnswer() {
    if (!response || committed) return;
    const now = Date.now();
    setCommitted({ answerMs: now - startedAt, at: now });
  }

  /**
   * Уверенность отправляет ответ сразу, без второй кнопки: оценка «насколько
   * уверен» тем достовернее, чем меньше её обдумывают (Koriat, cue-utilization
   * framework), а лишний шаг подтверждения провоцирует именно обдумывание.
   */
  async function submit(confidence: number) {
    if (!sessionId || !current || !response || !committed) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/practice/sessions/${sessionId}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: current.assessmentId,
          response,
          responseTimeMs: committed.answerMs,
          confidenceLevel: confidence,
          confidenceLatencyMs: Date.now() - committed.at,
          jokLevel: jokLevel ?? undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Не удалось отправить ответ');
      setReveal(body);

      // Подсказки считаются ПОСЛЕ ответа и по фактической телеметрии сессии.
      // `isCorrect` при отложенной обратной связи ещё неизвестен — тогда
      // считаем ответ верным, чтобы правило контраста не срабатывало на
      // догадке: ошибочная подсказка дороже пропущенной.
      const sample: HintResponseSample = {
        assessmentId: current.assessmentId,
        nodeId: current.nodeId,
        isCorrect: body.revealed ? Boolean(body.isCorrect) : true,
        responseTimeMs: committed.answerMs,
        confidenceLevel: confidence,
        jokLevel,
        cognitiveLevel: current.cognitiveLevel,
        errorKind: null,
        flaggedConfusion: confused,
        blockType: current.blockType ?? null,
      };
      const nextSamples = [...samples, sample];
      setSamples(nextSamples);
      evaluate({
        responses: nextSamples,
        currentIndex: nextSamples.length - 1,
        nextCognitiveLevel: items[index + 1]?.cognitiveLevel ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сеть недоступна');
    } finally {
      setSubmitting(false);
    }
  }

  async function advance() {
    if (index + 1 < items.length) {
      setIndex(index + 1);
      setJokLevel(null);
      setResponse(null);
      setCommitted(null);
      setReveal(null);
      setConfused(false);
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

  /**
   * Действие подсказки. Ни одно из них не меняет подбор заданий, длину набора
   * и расписание FSRS — это ограждение всего механизма, а не оговорка.
   * Модалок подсказка тоже не открывает: переход идёт на нормальный экран.
   */
  const swipe = useSwipe((direction) => {
    if (direction === 'left' && reveal && !submitting) void advance();
  });

  const onHintOutcome = useCallback(
    (outcome: HintOutcome, entry: Hint) => {
      const nodeIdOfItem = items[index]?.nodeId ?? null;

      if (outcome === 'acted' && entry.action) {
        const action = entry.action;
        if (action.kind === 'start_rest_timer') setResting(action.seconds);
        if (action.kind === 'open_note') router.push(`/notes?note=${action.noteId}`);
        if (action.kind === 'open_contrast') {
          router.push(`/paths?contrast=${action.nodeId}`);
        }
        if (action.kind === 'capture_note') {
          const params = new URLSearchParams({ nodeId: action.nodeId, capture: '1' });
          if (action.confusion) params.set('confusion', '1');
          if (action.assessmentId) params.set('assessmentId', action.assessmentId);
          if (sessionId) params.set('sessionId', sessionId);
          router.push(`/notes?${params}`);
        }
        if (action.kind === 'open_tutor') {
          const params = new URLSearchParams({ nodeId: action.nodeId });
          if (action.assessmentId) params.set('assessmentId', action.assessmentId);
          router.push(`/tutor?${params}`);
        }
        // `request_hint` ничего не открывает: наводящие подсказки уже
        // приходят в разборе задания, карточка лишь напоминает об этом.
      }

      resolve(outcome, entry, index, nodeIdOfItem);
    },
    [index, items, resolve, router, sessionId],
  );

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
    const nodeTitleById = new Map(items.map((item) => [item.nodeId, item.nodeTitle]));
    // Продуктивная неудача триггерится ошибкой, а не тем, что человек сам
    // открыл тьютора (PRD §3 п.4) — ссылка появляется автоматически для
    // каждого неверного ответа уровня apply и выше.
    const hypothesisCandidates = summary.results.filter(
      (r) => !r.isCorrect && r.cognitiveLevel !== null && DEEP_LEVELS.has(r.cognitiveLevel),
    );

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
                <span>
                  <GlossaryTerm term="strength">Прочность знания</GlossaryTerm>
                </span>
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

          {hypothesisCandidates.length > 0 ? (
            <div className="rounded-md border border-border bg-bg p-3 text-xs text-fg-muted">
              <p className="mb-2">
                Есть неверные ответы уровня apply и выше. Прежде чем смотреть разбор, полезно
                сформулировать гипотезу — почему ответ неверен.
              </p>
              <ul className="flex flex-col gap-1">
                {hypothesisCandidates.map((r) => (
                  <li key={r.assessmentId}>
                    <Link
                      href={`/tutor?nodeId=${r.nodeId}&assessmentId=${r.assessmentId}`}
                      className="text-accent hover:underline"
                    >
                      {nodeTitleById.get(r.nodeId) ?? 'Узел'} — сформулировать гипотезу с тьютором
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
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

  const difficulty = bloomDifficulty(current.cognitiveLevel);

  return (
    <div
      className="mt-8 flex flex-col gap-3"
      // Свайп влево листает дальше — но только когда разбор уже открыт.
      // Пролистнуть незаконченный ответ значило бы его потерять, а жест
      // срабатывает и случайно. Кнопка «Далее» на месте: жест дублирует её,
      // а не заменяет.
      {...swipe}
    >
      {/* Подсказка стоит НАД заданием и ничего не перекрывает. Она появляется
          только после ответа (или до первого задания) — во время ввода
          движок не вызывается вовсе. */}
      {hint ? <HintCard hint={hint} onOutcome={onHintOutcome} /> : null}
      {resting !== null ? (
        <RestTimer seconds={resting} onDone={() => setResting(null)} />
      ) : null}

    <Card>
      <CardHeader>
        <div className="flex items-center justify-between text-xs text-fg-subtle">
          <span>{current.nodeTitle}</span>
          <span className="flex items-center gap-2">
            {difficulty !== null ? (
              <span
                className="rounded-full border border-border px-1.5 py-0.5 tabular-nums"
                title={`Уровень по Блуму: ${current.cognitiveLevel}`}
              >
                сложность {difficulty}/5
              </span>
            ) : null}
            {index + 1} / {items.length}
          </span>
        </div>
        <CardTitle className="text-base font-normal leading-snug text-fg">{current.prompt}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {jokLevel === null ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-fg-subtle">
              Ещё не отвечая: насколько ты ощущаешь, что знаешь это? 1 — не знаю, 5 — точно
              знаю. Это <GlossaryTerm term="jok">JOK</GlossaryTerm>.
            </p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => answerJok(level)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md border text-xs tabular-nums transition-colors',
                    'border-border bg-bg text-fg-muted hover:bg-bg-hover',
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        ) : !reveal ? (
          <>
            <AssessmentInput
              payload={current.payload}
              value={response}
              onChange={setResponse}
              disabled={committed !== null}
            />

            {error ? <p className="text-xs text-red-400">{error}</p> : null}

            {!committed ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!response} onClick={commitAnswer}>
                  Ответить
                </Button>
                {/* Флаг «не понял» — вход в реестр непонимания. Он не влияет
                    ни на оценку ответа, ни на расписание: это пометка о
                    состоянии человека, а не о правильности. */}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={confused}
                  onClick={() => setConfused(!confused)}
                  className={confused ? 'text-[var(--color-status-has-gaps)]' : undefined}
                >
                  <HelpCircle aria-hidden />
                  {confused ? 'Отмечено: не понял' : 'Не понял'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-fg-subtle">
                  Насколько ты уверен(а) в ответе? 1 — угадал(а), 5 — знаю точно. Пара с
                  правильностью даёт <GlossaryTerm term="calibration">калибровку</GlossaryTerm>.
                </p>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={level}
                      type="button"
                      disabled={submitting}
                      onClick={() => void submit(level)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-md border text-xs tabular-nums transition-colors',
                        'border-border bg-bg text-fg-muted hover:bg-bg-hover disabled:opacity-50',
                      )}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
    </div>
  );
}

/**
 * После фиксации ответа поля блокируются: шаг уверенности уже начался, и
 * правка ответа задним числом сделала бы пару (уверенность, правильность)
 * бессмысленной — оценивалось бы одно, а проверялось другое.
 *
 * `fieldset[disabled]` вместо проброса флага в каждый инпут: браузер сам
 * снимает фокусируемость со всего содержимого, включая будущие типы заданий.
 */
function AssessmentInput({
  payload,
  value,
  onChange,
  disabled,
}: {
  payload: AssessmentPayload;
  value: UserResponsePayload | null;
  onChange: (value: UserResponsePayload) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="contents">
      <AssessmentFields payload={payload} value={value} onChange={onChange} />
    </fieldset>
  );
}

function AssessmentFields({
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
