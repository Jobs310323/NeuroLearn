/**
 * Персональная целевая вероятность вспоминания (`request_retention`) —
 * по узлу, а не одна на всё.
 *
 * `users.preferences.requestRetention` до сих пор было единственным
 * источником: FSRS планировал ВСЕ карточки на одну и ту же целевую
 * вероятность вспоминания, независимо от того, второстепенный это узел или
 * ключевой для цели пути. `knowledge_nodes.weight` (0..1, важность узла для
 * цели) уже существует и нигде не влияет на планирование повторений — это
 * ровно такой же неиспользуемый сигнал, каким был `cognitive_profile` до
 * Фазы 1.
 *
 * Эвристика: важный узел стоит держать на более высокой retention (реже
 * забывать ценой более частых повторений), второстепенный — можно отпустить
 * ниже пользовательского умолчания. Диапазон сдвига ±0.05 и общие границы
 * 0.80..0.97 — за пределами этого FSRS либо переоценивает интервалы
 * (retention ниже 0.8), либо требует повторений почти ежедневно
 * (retention выше 0.97), в обоих случаях эффект перестаёт быть управляемым.
 */

const ADJUSTMENT_RANGE = 0.05;
const MIN_RETENTION = 0.8;
const MAX_RETENTION = 0.97;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function personalRequestRetention(nodeWeight: number, base: number): number {
  const adjustment = (clamp(nodeWeight, 0, 1) - 0.5) * (2 * ADJUSTMENT_RANGE);
  return clamp(base + adjustment, MIN_RETENTION, MAX_RETENTION);
}
