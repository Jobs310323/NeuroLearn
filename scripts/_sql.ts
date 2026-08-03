/**
 * Общий SQL-хелпер для скриптов сопровождения.
 * HTTP-эндпоинт Neon периодически обрывает соединение — повторяем транспортные
 * сбои, ошибки SQL пробрасываем сразу.
 */
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

config({ path: '.env.local' });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL не задан.');

const client = neon(url);

const TRANSPORT_ERRORS = ['fetch failed', 'ECONNRESET', 'Connection terminated', 'socket hang up'];
const ALREADY_APPLIED = /already exists|duplicate key value/i;

/** `fetch` может зависнуть без ответа — ограничиваем ожидание вручную. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('fetch failed: timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sql(text: string, params: unknown[] = []): Promise<unknown[]> {
  const maxAttempts = 8;
  let retrying = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return (await withTimeout(client.query(text, params), 20_000)) as unknown[];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Обрыв соединения происходит и ПОСЛЕ успешного выполнения оператора:
      // ответ теряется, сервер работу уже сделал. Тогда повтор упирается
      // в «already exists» — считаем такой случай успехом.
      if (retrying && ALREADY_APPLIED.test(message)) return [];

      if (!TRANSPORT_ERRORS.some((t) => message.includes(t)) || attempt === maxAttempts) {
        throw error;
      }
      retrying = true;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw new Error('unreachable');
}
