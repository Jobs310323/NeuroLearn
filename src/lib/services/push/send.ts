import webPush from 'web-push';

/**
 * Обёртка над `web-push`: конфигурация VAPID один раз за процесс и типизированный
 * результат отправки. Три переменные окружения обязательны — без них Push API
 * не работает в принципе (это не техническая деталь конфигурации, а часть
 * протокола: браузер шифрует подписку под конкретную пару ключей).
 */

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      'Web Push не настроен: нужны VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT в .env.local. ' +
        'Сгенерировать: npm run generate:vapid-keys',
    );
  }
  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url?: string };
export type SendResult = { ok: true } | { ok: false; expired: boolean; error: string };

/**
 * `expired` различает две причины отказа: подписка мертва (браузер её отозвал,
 * профиль удалён, устройство сброшено — коды 404/410) против временного сбоя
 * доставки. Только первое — сигнал удалить строку из `push_subscriptions`;
 * второе стоит просто залогировать и попробовать в следующий раз.
 */
export async function sendPush(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<SendResult> {
  ensureConfigured();
  try {
    await webPush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    const expired = statusCode === 404 || statusCode === 410;
    return { ok: false, expired, error: error instanceof Error ? error.message : String(error) };
  }
}
