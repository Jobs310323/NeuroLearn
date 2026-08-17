import { config } from 'dotenv';
config({ path: '.env.local' });

const { enableEnvProxy } = await import('@/lib/net/proxy');
enableEnvProxy();

/**
 * Проверка канала оповещений: отправляет одно тестовое сообщение в
 * `ALERT_WEBHOOK_URL` и печатает ответ.
 *
 * Нужно потому, что настоящий путь оповещения (`logError` -> `sendAlert`)
 * срабатывает только на критичной ошибке в проде — то есть проверить его
 * можно было бы, лишь дождавшись аварии. Ошибка в адресе вебхука иначе
 * обнаруживается ровно тогда, когда оповещение и требовалось.
 *
 * Использование: npm run test:alert
 */

const webhookUrl = process.env.ALERT_WEBHOOK_URL;

if (!webhookUrl) {
  console.error(
    'ALERT_WEBHOOK_URL не задан. Годится входящий вебхук Slack (https://api.slack.com/messaging/webhooks)\n' +
      'или адрес вида https://api.telegram.org/bot<токен>/sendMessage?chat_id=<id>&text= для Telegram.',
  );
  process.exit(1);
}

const payload = {
  text: `NeuroLearn — тестовое оповещение, отправлено ${new Date().toISOString()}. Настоящих ошибок нет.`,
};

try {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });

  const body = (await response.text()).slice(0, 500);
  console.log(`HTTP ${response.status} ${response.statusText}`);
  if (body) console.log(body);

  if (!response.ok) {
    console.error('\nВебхук ответил ошибкой — оповещения о критичных сбоях не дойдут.');
    process.exit(1);
  }
  console.log('\nОповещение отправлено. Проверьте, что сообщение видно в канале.');
} catch (error) {
  console.error(`Запрос не удался: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
