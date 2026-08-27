/**
 * Гибридный поиск по тетради: слияние полнотекстового и векторного
 * ранжирований.
 *
 * Почему RRF (Reciprocal Rank Fusion), а не взвешенная сумма оценок.
 * Оценки двух поисков несопоставимы: `ts_rank` Postgres и косинусное
 * расстояние живут в разных шкалах, и любая формула вида `0.6·fts + 0.4·vec`
 * требует нормализации, которая зависит от конкретной выдачи. RRF работает
 * с РАНГАМИ, а не с оценками: он спрашивает «на каком месте документ в каждом
 * списке», и потому не нуждается ни в калибровке, ни в предположениях о
 * распределении.
 *
 * Формула: score(d) = Σ 1 / (k + rank_i(d)), k = 60 (значение из исходной
 * работы Cormack et al., 2009; оно сглаживает вклад верхних позиций так,
 * чтобы первое место не подавляло всё остальное).
 *
 * Модуль чистый: слияние проверяется тестом, без базы и без модели.
 */

export type RankedHit = { id: string; rank: number };

export type FusedHit = {
  id: string;
  score: number;
  /** В каких источниках документ найден — показывается в интерфейсе. */
  sources: ('fts' | 'vector')[];
  ftsRank: number | null;
  vectorRank: number | null;
};

/** Сглаживающая константа RRF. Меньше — резче доминируют первые позиции. */
export const RRF_K = 60;

/**
 * Ранги считаются от единицы. Порядок массива и есть ранжирование —
 * вызывающему коду не нужно проставлять номера руками, и он не сможет
 * ошибиться в нумерации.
 */
export function toRanked(ids: string[]): RankedHit[] {
  return ids.map((id, index) => ({ id, rank: index + 1 }));
}

export function fuseRrf(
  fts: RankedHit[],
  vector: RankedHit[],
  k = RRF_K,
): FusedHit[] {
  const byId = new Map<string, FusedHit>();

  const add = (hit: RankedHit, source: 'fts' | 'vector') => {
    const existing = byId.get(hit.id) ?? {
      id: hit.id,
      score: 0,
      sources: [] as ('fts' | 'vector')[],
      ftsRank: null,
      vectorRank: null,
    };
    existing.score += 1 / (k + hit.rank);
    existing.sources.push(source);
    if (source === 'fts') existing.ftsRank = hit.rank;
    else existing.vectorRank = hit.rank;
    byId.set(hit.id, existing);
  };

  for (const hit of fts) add(hit, 'fts');
  for (const hit of vector) add(hit, 'vector');

  return [...byId.values()].sort(
    // Тай-брейк по id, а не по порядку вставки: одинаковые входные данные
    // обязаны давать одинаковую выдачу.
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  );
}

/**
 * Хеш содержимого заметки. По нему решается, устарел ли вектор: пересчитывать
 * эмбеддинг на каждое сохранение заметки — впустую жечь и время, и батарею
 * (эмбеддинги считаются локально в браузере).
 *
 * Нормализация перед хешем нарочно грубая: правка пробелов и переводов строк
 * не меняет смысла и не должна запускать пересчёт.
 */
export function contentHash(title: string | null, contentMd: string): string {
  const normalized = `${title ?? ''}\n${contentMd}`
    .replace(/\r\n/g, '\n')
    .split('\n')
    // Обрезается каждая строка, а не вся заметка целиком: отступ в начале
    // строки — та же незначащая правка, что и двойной пробел внутри неё.
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase();

  // FNV-1a, 32 бита, в hex. Криптостойкость здесь не нужна: хеш сравнивается
  // сам с собой и не защищает ни от чего — он отвечает на вопрос «текст тот
  // же?», и коллизия означает лишь пропущенный пересчёт вектора.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Косинусная близость. Считается на клиенте при отборе кандидатов и на
 * сервере, когда векторного индекса нет: две реализации разошлись бы, поэтому
 * она одна.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
