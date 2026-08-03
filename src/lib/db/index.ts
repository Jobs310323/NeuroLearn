import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema';

/**
 * Клиент Drizzle поверх Neon, драйвер `neon-http`.
 *
 * Почему HTTP, а не WebSocket/TCP: HTTP-эндпоинт Neon доступен из любой сети
 * и из edge-рантайма, тогда как порт 5432 и WSS часто закрыты корпоративными
 * и провайдерскими фильтрами (на машине разработки — именно этот случай).
 *
 * Плата за это — нет интерактивных транзакций (`db.transaction(async tx => …)`).
 * Атомарность обеспечивается `db.batch([...])`: Neon выполняет список запросов
 * в одной транзакции. Правило для сервисов: сначала все чтения, затем расчёт
 * в JS, затем один `batch` со всеми записями.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL не задан. Скопируйте .env.example в .env.local.');
}

// В разработке сеть до Neon бывает нестабильной — терпим дольше.
// В продакшене (Vercel) лишние попытки только удлиняют отказ.
const MAX_ATTEMPTS = process.env.NODE_ENV === 'production' ? 3 : 8;
const CONNECT_TIMEOUT_MS = 60_000;

/**
 * Определяет, безопасен ли повтор запроса.
 *
 * Обрыв соединения бывает и ПОСЛЕ выполнения запроса на сервере — ответ
 * теряется, а работа уже сделана. Для `INSERT` слепой повтор создаёт дубль,
 * поэтому повторяем только читающие запросы. Пишущие отдаём наверх с ошибкой:
 * пользователь повторит действие сам, увидев результат.
 */
function isReadOnlyRequest(init?: RequestInit): boolean {
  const body = init?.body;
  if (typeof body !== 'string') return false;

  try {
    const parsed: unknown = JSON.parse(body);
    const queries =
      parsed && typeof parsed === 'object' && 'queries' in parsed
        ? (parsed as { queries: { query?: unknown }[] }).queries
        : [parsed as { query?: unknown }];

    return queries.every((q) => {
      const text = typeof q?.query === 'string' ? q.query.trimStart().toLowerCase() : '';
      return text.startsWith('select') || text.startsWith('with');
    });
  } catch {
    return false;
  }
}

/**
 * Повтор только транспортных сбоев: `fetch` бросает исключение, когда
 * соединение не установилось или оборвалось. Ошибки SQL приходят обычным
 * HTTP-ответом и сюда не попадают — их не повторяем.
 */
async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Скрипты сопровождения пишут идемпотентно (явные id + onConflictDoNothing)
  // и могут разрешить повтор записей флагом окружения.
  const retryWrites = process.env.NEURO_DB_RETRY_WRITES === '1';
  const attempts = retryWrites || isReadOnlyRequest(init) ? MAX_ATTEMPTS : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
    }
  }

  throw lastError;
}

// Подменять fetch нужно именно глобально: опция `fetchFunction` живёт
// в `neonConfig`, а не в аргументах `neon()` — там она молча игнорируется.
neonConfig.fetchFunction = fetchWithRetry;

const sql = neon(url);

export const db = drizzle(sql, { schema });

export type Db = typeof db;
export { schema };
