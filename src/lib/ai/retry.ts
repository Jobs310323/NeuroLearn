/**
 * Backoff между попытками генерации УЗЛА (оркестратор в `scripts/generate-content.ts`),
 * не внутри `generateValidated` — там retry уже есть с другим смыслом
 * (повтор той же модели с текстом ошибки схемы, не переживание перегрузки апстрима).
 */
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
      if (attempt === opts.retries) break;
      const delay = opts.baseMs * 2 ** attempt * (0.5 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
