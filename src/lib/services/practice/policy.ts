/**
 * Политика подбора практики — чистая функция поверх когнитивного портрета.
 *
 * До Фазы 1 портрет (`users.cognitive_profile`) не имел писателя и навсегда
 * оставался значением по умолчанию — читать его политикой не было смысла.
 * Теперь он живой (`recomputeCognitiveProfile` после каждой сессии), и это
 * первое место, где система решает не только ЧТО повторять (`selector.ts`),
 * но и КАК: сколько заданий предложить за раз и насколько активно мешать
 * узлы.
 *
 * Намеренно НЕ читает индекс усталости (`fatigue.ts`): тот собирается только
 * в аналитику (план, Фаза 1 п.12) и не должен влиять на подбор, пока не
 * накопится месяц наблюдений, подтверждающих, что сигнал не шум.
 */

export type PolicyProfile = {
  /** 0.2..0.6 — устойчивость к перемешиванию (`computeInterleavingTolerance`). */
  interleavingTolerance: number;
  /** Желаемая длина сессии в минутах — до сих пор нигде не читалась. */
  preferredSessionMinutes: number;
  /** Медиана времени верного ответа, мс. `null`, пока не накопилось наблюдений. */
  avgResponseTimeMs: number | null;
};

export type PracticePolicy = { interleaveRatio: number; limit: number };

/** Запасной темп на один вопрос, когда `avgResponseTimeMs` ещё не посчитан. */
const DEFAULT_ITEM_PACE_MS = 45_000;
/** Время на шаг уверенности и чтение разбора — retrieval не единственная трата времени в раунде. */
const OVERHEAD_PER_ITEM_MS = 15_000;

const MIN_LIMIT = 4;
const MAX_LIMIT = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * `explicitInterleaveRatio` / `explicitLimit` — то, что пользователь (или
 * клиент) задал прямо через query-параметры `docs/API.md` §3. Явный выбор
 * человека всегда старше политики по умолчанию; политика заполняет только
 * то, что не задано явно.
 */
export function decidePolicy(params: {
  profile: PolicyProfile;
  mix: boolean;
  explicitInterleaveRatio?: number;
  explicitLimit?: number;
}): PracticePolicy {
  const interleaveRatio = params.mix
    ? (params.explicitInterleaveRatio ?? params.profile.interleavingTolerance)
    : 0;

  if (params.explicitLimit !== undefined) {
    return { interleaveRatio, limit: params.explicitLimit };
  }

  const paceMs = params.profile.avgResponseTimeMs ?? DEFAULT_ITEM_PACE_MS;
  const perItemMs = paceMs + OVERHEAD_PER_ITEM_MS;
  const budgetMs = params.profile.preferredSessionMinutes * 60_000;
  const paced = Math.round(budgetMs / perItemMs);

  return { interleaveRatio, limit: clamp(paced, MIN_LIMIT, MAX_LIMIT) };
}
