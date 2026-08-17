/**
 * Backoff между попытками генерации УЗЛА (оркестратор в `scripts/generate-content.ts`),
 * не внутри `generateValidated` — там retry уже есть с другим смыслом
 * (повтор той же модели с текстом ошибки схемы, не переживание перегрузки апстрима).
 */
/**
 * Отказы, которые повтором не лечатся: исчерпанная суточная квота, пустой счёт,
 * недействительный ключ. Ждать тут нечего — ни через 5 секунд, ни через 20
 * ответ не изменится, а попытки продолжают жечь и без того исчерпанный лимит.
 *
 * Ровно на этом сгорел прогон 15 узлов: у OpenRouter кончилась дневная квота
 * бесплатных моделей, и каждый следующий узел исправно тратил на неё три
 * попытки с backoff вместо того, чтобы остановиться на первой.
 */
export function isPermanentFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /free-models-per-day|insufficient balance|payment required|invalid api key|unauthorized/i.test(
    message,
  );
}

export async function withJitteredBackoff<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseMs: number } = { retries: 2, baseMs: 4000 },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === opts.retries || isPermanentFailure(error)) break;
      const delay = opts.baseMs * 2 ** attempt * (0.5 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
