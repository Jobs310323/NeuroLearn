'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Настройки умных подсказок: мастер-выключатель и переключатель каждого типа.
 *
 * Отдельный переключатель на каждый тип — не щедрость, а следствие того, что
 * типы разные по характеру. Предложение перерыва одному человеку помогает,
 * другому мешает; метакогнитивный разбор нужен не всем и не всегда. Один
 * общий выключатель заставил бы отказаться от всех шести из-за одного.
 */

const RULE_META: Record<string, { label: string; description: string }> = {
  rest_suggestion: {
    label: 'Предложение перерыва',
    description:
      'Когда темп ответов внутри сессии заметно замедлился. Таймер запускаете вы, не система.',
  },
  metacognitive_coaching: {
    label: 'Разбор калибровки',
    description: 'Когда высокая уверенность совпала с неверным ответом.',
  },
  contrast_mode_offer: {
    label: 'Контрастное сравнение',
    description: 'Когда ошибки повторяются на близких темах — похоже на смешение понятий.',
  },
  difficulty_indicator: {
    label: 'Уровень сложности',
    description: 'Чип уровня по Блуму и напоминание, что можно запросить наводящую подсказку.',
  },
  capture_nudge: {
    label: 'Записать мысль',
    description: 'После флага «не понял» или провала задания на перенос.',
  },
  review_before_session: {
    label: 'Перечитать перед практикой',
    description: 'Когда у узлов сессии есть заметки, к которым пора вернуться.',
  },
};

type HintSettings = { enabled: boolean; disabledRules: string[]; availableRules: string[] };

export function HintSettings() {
  const [settings, setSettings] = useState<HintSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/hints');
    if (res.ok) setSettings(await res.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/settings/hints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <p className="text-sm text-fg-muted">Загружаю настройки…</p>;

  const disabled = new Set(settings.disabledRules);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-fg">Подсказки в практике</p>
          <p className="text-xs text-fg-muted">
            Подсказки не меняют подбор заданий, длину набора и расписание повторений. Они
            только сообщают наблюдение.
          </p>
        </div>
        <Button
          size="sm"
          variant={settings.enabled ? 'secondary' : 'default'}
          disabled={busy}
          aria-pressed={settings.enabled}
          onClick={() => void patch({ enabled: !settings.enabled })}
        >
          {settings.enabled ? 'Выключить все' : 'Включить'}
        </Button>
      </div>

      <ul className={cn('flex flex-col gap-2', !settings.enabled && 'opacity-50')}>
        {settings.availableRules.map((ruleId) => {
          const meta = RULE_META[ruleId];
          const off = disabled.has(ruleId);
          return (
            <li
              key={ruleId}
              className="flex items-start justify-between gap-3 rounded-md border border-border bg-bg p-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-fg">{meta?.label ?? ruleId}</p>
                <p className="text-xs text-fg-subtle">{meta?.description}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !settings.enabled}
                aria-pressed={!off}
                onClick={() =>
                  void patch(off ? { enableRule: ruleId } : { disableRule: ruleId })
                }
              >
                {off ? 'Включить' : 'Выключить'}
              </Button>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-fg-subtle">
        Каждое срабатывание записывается обезличенно — правило, исход и числа, при которых
        оно сработало. Через месяц эти данные станут основанием пересмотреть пороги; сейчас
        они обоснованные догадки, и называть их иначе было бы нечестно.
      </p>
    </div>
  );
}
