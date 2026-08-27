import webPush from 'web-push';

/**
 * Одноразовая генерация ключей VAPID для Web Push. Приватный ключ — секрет:
 * скрипт только печатает пару, класть её в `.env.local` — ручное действие.
 *
 * Использование:
 *   npx tsx scripts/generate-vapid-keys.ts
 */

const keys = webPush.generateVAPIDKeys();

console.log('Добавьте в .env.local:');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.log('');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log('');
console.log('NEXT_PUBLIC_VAPID_PUBLIC_KEY — тот же публичный ключ, но с префиксом NEXT_PUBLIC_:');
console.log('браузеру он нужен на клиенте при подписке (PushManager.subscribe), приватный туда не попадает.');

process.exit(0);
