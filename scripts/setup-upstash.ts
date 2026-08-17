import { config } from 'dotenv';
config({ path: '.env.local' });

const { enableEnvProxy } = await import('@/lib/net/proxy');
enableEnvProxy();

/**
 * Получение переменных `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
 * через Management API вместо ручного копирования из консоли.
 *
 * По умолчанию скрипт ТОЛЬКО читает: показывает базы аккаунта и печатает
 * готовые строки для `.env.local`. Создание базы — отдельный флаг `--create`,
 * потому что это заведение ресурса в чужом аккаунте, и делаться оно должно по
 * явному решению человека, а не как побочный эффект запуска скрипта.
 *
 * Доступ к Management API — Basic-авторизация парой «почта аккаунта : ключ»
 * (это НЕ тот ключ, что лежит в UPSTASH_REDIS_REST_TOKEN). Ключ выпускается в
 * консоли: Account → Management API.
 *
 * Использование:
 *   npm run setup:upstash                       # показать базы и переменные
 *   npm run setup:upstash -- --create neurolearn
 */

const email = process.env.UPSTASH_EMAIL;
const apiKey = process.env.UPSTASH_MANAGEMENT_API_KEY;

if (!email || !apiKey) {
  console.error(
    'Нужны две переменные в .env.local:\n' +
      '  UPSTASH_EMAIL=почта аккаунта Upstash\n' +
      '  UPSTASH_MANAGEMENT_API_KEY=ключ из Account -> Management API\n\n' +
      'Почта обязательна: Management API авторизует пару «почта:ключ», и с чужой\n' +
      'почтой верный ключ отвечает 401 — по ответу не отличить неверный ключ от\n' +
      'неверной почты.',
  );
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${email}:${apiKey}`).toString('base64')}`;

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`https://api.upstash.com${path}`, {
    ...init,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        `401 Unauthorized. Проверьте, что UPSTASH_EMAIL — почта именно этого аккаунта Upstash, ` +
          `а ключ выпущен в Account -> Management API (ключ базы сюда не подходит).`,
      );
    }
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

type Database = {
  database_id: string;
  database_name: string;
  endpoint: string;
  rest_token: string;
  region?: string;
};

function printEnv(database: Database): void {
  console.log(`\nДля .env.local и переменных окружения Vercel:`);
  console.log(`UPSTASH_REDIS_REST_URL=https://${database.endpoint}`);
  console.log(`UPSTASH_REDIS_REST_TOKEN=${database.rest_token}`);
  console.log(`\nПроверка: npm run check-env`);
}

const args = process.argv.slice(2);
const createIndex = args.indexOf('--create');

if (createIndex === -1) {
  const databases = (await call('/v2/redis/databases')) as Database[];

  if (databases.length === 0) {
    console.log(
      'В аккаунте нет ни одной базы Redis.\n' +
        'Создать: npm run setup:upstash -- --create neurolearn',
    );
    process.exit(0);
  }

  console.log(`Баз в аккаунте: ${databases.length}`);
  for (const database of databases) {
    console.log(`  ${database.database_name}  (${database.region ?? 'global'})  ${database.endpoint}`);
  }

  // Токены печатаются только для одной базы: если их несколько, выбор за
  // человеком, а вываливать все токены разом ни к чему.
  if (databases.length === 1) printEnv(databases[0]!);
  else console.log('\nБаз несколько — какую использовать, решать вам; токены смотрите в консоли Upstash.');

  process.exit(0);
}

const name = args[createIndex + 1];
if (!name) {
  console.error('После --create нужно имя базы: npm run setup:upstash -- --create neurolearn');
  process.exit(1);
}

console.log(`Создаю базу «${name}» в аккаунте ${email}...`);

const created = (await call('/v2/redis/database', {
  method: 'POST',
  body: JSON.stringify({
    name,
    // Глобальная реплика с основным регионом в Европе: приложение живёт на
    // Vercel, а лимит запросов читается на каждом обращении к AI-роуту —
    // задержка до Redis складывается с задержкой самой модели.
    region: 'global',
    primary_region: 'eu-west-1',
    tls: true,
  }),
})) as Database;

console.log(`Готово: ${created.database_name} (${created.database_id})`);
printEnv(created);
