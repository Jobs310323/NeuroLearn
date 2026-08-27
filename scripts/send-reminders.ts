import { config } from 'dotenv';
config({ path: '.env.local' });

/**
 * Ручной прогон рассылки напоминаний — тот же путь, что Vercel Cron
 * (`/api/cron/send-reminders`), но вызванный вручную для проверки. Сервер
 * должен быть запущен (`npm run dev`).
 *
 * Использование:
 *   npm run send-reminders
 *   npx tsx scripts/send-reminders.ts --url=http://localhost:3000
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const baseUrl = argValue('url') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const secret = process.env.CRON_SECRET;

const response = await fetch(`${baseUrl}/api/cron/send-reminders`, {
  headers: secret ? { Authorization: `Bearer ${secret}` } : {},
});

const body = await response.json();
console.log(`HTTP ${response.status}`);
console.log(JSON.stringify(body, null, 2));

process.exit(response.ok ? 0 : 1);
