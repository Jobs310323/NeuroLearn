'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { emptyHintContext, evaluateHints } from '@/lib/practice/hints/engine';
import type {
  Hint,
  HintOutcome,
  HintResponseSample,
  HintRuleId,
  HintShownRecord,
} from '@/lib/practice/hints/types';

/**
 * Состояние подсказок внутри одной сессии практики.
 *
 * Хук держит журнал показов (для cooldown и лимитов), отправляет события в
 * `hint_events` и умеет глушить тип подсказок навсегда. Сам расчёт — в чистом
 * движке; здесь только то, что без React не выразить.
 *
 * Отправка события никогда не ждётся и не влияет на практику: журнал нужен
 * для будущей настройки порогов, а не для работы правил.
 */

export type HintBootstrap = {
  enabled: boolean;
  disabledRules: string[];
  neighbours: Record<string, string[]>;
  dueNotes: { noteId: string; title: string; nodeId: string }[];
};

const EMPTY_BOOTSTRAP: HintBootstrap = {
  enabled: true,
  disabledRules: [],
  neighbours: {},
  dueNotes: [],
};

export function useHints({
  bootstrap,
  mode,
  sessionId,
}: {
  bootstrap: HintBootstrap | null;
  mode: string;
  sessionId: string | null;
}) {
  const config = bootstrap ?? EMPTY_BOOTSTRAP;
  const [hint, setHint] = useState<Hint | null>(null);
  const [muted, setMuted] = useState<HintRuleId[]>([]);
  const shownRef = useRef<HintShownRecord[]>([]);

  const disabledRules = useMemo(
    () => [...config.disabledRules, ...muted],
    [config.disabledRules, muted],
  );

  const log = useCallback(
    (outcome: HintOutcome, entry: Hint, itemIndex: number, nodeId: string | null) => {
      void fetch('/api/practice/hints/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleId: entry.ruleId,
          outcome,
          sessionId,
          nodeId,
          itemIndex,
          // В журнал уходят только значения срабатывания — числа и названия
          // правил. Тексты заданий и ответов сюда не попадают.
          trigger: entry.values,
        }),
      }).catch(() => {});
    },
    [sessionId],
  );

  /**
   * Пересчёт после ответа (или перед первым заданием при `currentIndex = -1`).
   * Никогда не вызывается во время ввода: подсказка, появившаяся под руками,
   * сбивает ответ, а не помогает.
   */
  const evaluate = useCallback(
    (params: {
      responses: HintResponseSample[];
      currentIndex: number;
      nextCognitiveLevel: string | null;
    }) => {
      const next = evaluateHints(
        emptyHintContext({
          mode,
          responses: params.responses,
          currentIndex: params.currentIndex,
          neighbours: config.neighbours,
          dueNotes: config.dueNotes,
          nextCognitiveLevel: params.nextCognitiveLevel,
          shown: shownRef.current,
          enabled: config.enabled,
          disabledRules,
        }),
      );

      if (!next) {
        setHint(null);
        return;
      }

      shownRef.current = [
        ...shownRef.current,
        { ruleId: next.ruleId, atIndex: params.currentIndex },
      ];
      setHint(next);
      log('shown', next, params.currentIndex, params.responses[params.currentIndex]?.nodeId ?? null);
    },
    [config, disabledRules, log, mode],
  );

  const resolve = useCallback(
    (outcome: HintOutcome, entry: Hint, itemIndex: number, nodeId: string | null) => {
      log(outcome, entry, itemIndex, nodeId);
      if (outcome === 'muted') {
        setMuted((current) => [...current, entry.ruleId]);
        // Отключение типа сохраняется в профиле: «больше не показывать»
        // означает «никогда», а не «до конца этой сессии».
        void fetch('/api/settings/hints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disableRule: entry.ruleId }),
        }).catch(() => {});
      }
      setHint(null);
    },
    [log],
  );

  return { hint, evaluate, resolve, clear: () => setHint(null) };
}
