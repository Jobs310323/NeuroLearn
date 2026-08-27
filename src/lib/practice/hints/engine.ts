import { HINT_RULES } from './rules';
import type { Hint, HintContext, HintRule } from './types';

/**
 * Движок правил подсказок.
 *
 * Чистая функция: вход — контекст сессии, выход — не более одной подсказки.
 * Не более одной намеренно: две карточки одновременно превращают практику в
 * ленту советов, и человек перестаёт читать обе.
 *
 * Что движок гарантирует, помимо самих правил:
 *   — подсказки не работают в `pre_assessment` (там задача — измерить, а не
 *     помочь: помощь исказит замер);
 *   — мастер-выключатель и отключение по типам старше любого правила;
 *   — cooldown и лимит за сессию соблюдаются до вызова `evaluate`, а не
 *     после — правило не должно уметь их обойти;
 *   — при нескольких сработавших выигрывает старшая по приоритету, при
 *     равенстве — та, что раньше в списке (детерминированность).
 *
 * Чего движок не делает никогда: не трогает подбор заданий, длину набора и
 * расписание FSRS. Подсказка — сообщение, а не вход в `decidePolicy`.
 */

/** Режим, в котором подсказки выключены целиком. */
const SILENT_MODE = 'pre_assessment';

export function evaluateHints(
  context: HintContext,
  rules: HintRule[] = HINT_RULES,
): Hint | null {
  if (!context.enabled) return null;
  if (context.mode === SILENT_MODE) return null;

  const disabled = new Set(context.disabledRules);
  const candidates: Hint[] = [];

  for (const rule of rules) {
    if (disabled.has(rule.id)) continue;
    if (!withinLimits(rule, context)) continue;

    const result = rule.evaluate(context);
    if (!result) continue;

    candidates.push({ ...result, ruleId: rule.id, priority: rule.priority });
  }

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      rules.findIndex((r) => r.id === a.ruleId) - rules.findIndex((r) => r.id === b.ruleId),
  );

  return candidates[0]!;
}

function withinLimits(rule: HintRule, context: HintContext): boolean {
  const shown = context.shown.filter((record) => record.ruleId === rule.id);
  if (shown.length >= rule.maxPerSession) return false;
  if (shown.length === 0) return true;

  const lastAt = Math.max(...shown.map((record) => record.atIndex));
  return context.currentIndex - lastAt >= rule.cooldownItems;
}

/**
 * Пустой контекст с безопасными умолчаниями. Нужен вызывающему коду, чтобы
 * не собирать все поля руками и не забыть одно из них — забытое `enabled`
 * означало бы подсказки у человека, который их выключил.
 */
export function emptyHintContext(overrides: Partial<HintContext> = {}): HintContext {
  return {
    mode: 'focused',
    responses: [],
    currentIndex: -1,
    neighbours: {},
    dueNotes: [],
    nextCognitiveLevel: null,
    shown: [],
    enabled: true,
    disabledRules: [],
    ...overrides,
  };
}
