/**
 * Логирование серверных ошибок. Вызовы LLM пишутся в `ai_generations`
 * (`src/lib/ai/audit.ts`) — это про всё остальное: фоновая работа в `after()`,
 * сетевые провалы, падения фоновых задач. Такие ошибки гасились молча, и
 * узнать о них было неоткуда.
 *
 * Без новых зависимостей: структурированный JSON в stdout собирает рантайм
 * (Vercel Logs / вывод `next dev`). Вебхук опционален — той же логикой, что
 * в `rate-limit.ts`: не задан, значит функциональность просто выключена.
 */

const webhookUrl = process.env.ALERT_WEBHOOK_URL;

/** Ошибки, о которых мало знать из лога: чинить надо сразу, иначе приложение мертво. */
const CRITICAL_PATTERNS = [/DATABASE/i, /OPENROUTER/i, /ECONNREFUSED/i, /AUTH_SECRET/i];

type Fields = Record<string, unknown>;

function serializeError(error: unknown): Fields {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }
  return { message: String(error) };
}

export function logEvent(name: string, fields: Fields = {}): void {
  console.log(JSON.stringify({ type: 'event', name, timestamp: new Date().toISOString(), ...fields }));
}

/**
 * `context` — короткая метка места вызова (`'generate-module:background'`),
 * по ней ошибка ищется в логах.
 */
export function logError(error: unknown, context: string, fields: Fields = {}): void {
  const serialized = serializeError(error);

  console.error(
    JSON.stringify({ type: 'error', context, timestamp: new Date().toISOString(), ...serialized, ...fields }),
  );

  const message = String(serialized.message ?? '');
  if (CRITICAL_PATTERNS.some((pattern) => pattern.test(message))) {
    void sendAlert(context, message);
  }
}

/** Предупреждение об отсутствии вебхука — один раз за жизнь процесса. */
let warnedAboutWebhook = false;

async function sendAlert(context: string, message: string): Promise<void> {
  if (!webhookUrl) {
    // Критичная ошибка есть, а канал оповещения не настроен. Само по себе это
    // законный режим (лог всё равно записан), но узнать о нём надо из лога, а
    // не из тишины: иначе кажется, что алерты работают.
    if (!warnedAboutWebhook) {
      warnedAboutWebhook = true;
      console.warn(
        'ALERT_WEBHOOK_URL не задан: критичные ошибки остаются только в логе. ' +
          'Проверить канал: npm run test:alert',
      );
    }
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `NeuroLearn — критичная ошибка в ${context}: ${message}` }),
    });
  } catch (error) {
    // Провал алерта не должен ронять обработку запроса: сам факт уже в логе выше.
    console.error(JSON.stringify({ type: 'error', context: 'alert-webhook', ...serializeError(error) }));
  }
}
