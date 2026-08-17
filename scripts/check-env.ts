import { config } from 'dotenv';
import { z } from 'zod';

config({ path: '.env.local' });

/**
 * Проверка окружения перед `dev`/`build`.
 *
 * Обязательные переменные проверяются по форме (не по значению — сверять не с
 * чем): опечатка при ручной ротации ловится здесь, а не превращается в
 * `AiNotConfiguredError` посреди многоминутной генерации.
 *
 * Необязательные не валят сборку, но перечисляются с последствиями. Это и есть
 * главное отличие от прежней версии: раньше про выключенный лимит запросов,
 * молчащие оповещения и открытый cron-эндпоинт нельзя было узнать ниоткуда,
 * кроме чтения исходников.
 */

/** В `.env.local` незаполненный секрет — пустая строка, не отсутствующий ключ. */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optional = (schema: z.ZodTypeAny) => z.preprocess(emptyToUndefined, schema.optional());

const PROVIDER_KEYS = [
  'DEEPSEEK_API_KEY',
  'GROQ_API_KEY',
  'CEREBRAS_API_KEY',
  'TOGETHER_API_KEY',
  'MISTRAL_API_KEY',
  'OPENROUTER_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
] as const;

const envSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'должен начинаться с postgres(ql)://'),
  AUTH_SECRET: z.string().min(32, 'короче 32 символов — сгенерировать заново'),
  AUTH_OWNER_EMAIL: z.string().email('не похоже на e-mail'),
  AUTH_OWNER_PASSWORD: z.string().min(8, 'короче 8 символов'),
  AI_PROVIDER: optional(
    z.enum(['deepseek', 'groq', 'cerebras', 'together', 'mistral', 'openrouter', 'google']),
  ),
  // Форма проверяется только у OpenRouter: остальные провайдеры выдают ключи
  // без устойчивого узнаваемого формата, и regex по ним ловил бы не опечатки,
  // а собственную устарелость.
  OPENROUTER_API_KEY: optional(
    z.string().regex(/^sk-or-v1-[a-f0-9]{64}$/, 'не похож на текущий формат ключа OpenRouter'),
  ),
  DEEPSEEK_API_KEY: optional(z.string().min(20)),
  GROQ_API_KEY: optional(z.string().min(20)),
  CEREBRAS_API_KEY: optional(z.string().min(20)),
  TOGETHER_API_KEY: optional(z.string().min(20)),
  MISTRAL_API_KEY: optional(z.string().min(20)),
  GOOGLE_GENERATIVE_AI_API_KEY: optional(z.string().min(20)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Проверка .env провалена:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const data = parsed.data;
const configuredProviders = PROVIDER_KEYS.filter((key) => data[key] !== undefined);

if (configuredProviders.length === 0) {
  console.error(
    'Ни один провайдер моделей не настроен. Задайте хотя бы один ключ:\n' +
      `  ${PROVIDER_KEYS.join('\n  ')}\n` +
      'Где их брать — раздел «Ручные настройки» в README.md.',
  );
  process.exit(1);
}

// Явно выбранный провайдер без ключа — не «возьмём другой», а ошибка: тихая
// подмена основного провайдера означала бы генерацию не на той модели, за
// которую человек заплатил или которую проверил.
const KEY_BY_PROVIDER: Record<string, (typeof PROVIDER_KEYS)[number]> = {
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  together: 'TOGETHER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
};

const selectedProvider = typeof data.AI_PROVIDER === 'string' ? data.AI_PROVIDER : undefined;
if (selectedProvider) {
  const keyName = KEY_BY_PROVIDER[selectedProvider]!;
  if (data[keyName] === undefined) {
    console.error(`AI_PROVIDER=${selectedProvider}, но ${keyName} не задан.`);
    process.exit(1);
  }
}

const notes: string[] = [];

const hasUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
if (!hasUpstash && process.env.RATE_LIMIT_DISABLED !== '1') {
  notes.push(
    'UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN не заданы: лимит запросов к AI-роутам\n' +
      '    не работает, и в production такая сборка вернёт ошибку. Осознанный отказ — RATE_LIMIT_DISABLED=1.',
  );
}
if (!process.env.ALERT_WEBHOOK_URL) {
  notes.push('ALERT_WEBHOOK_URL не задан: критичные ошибки останутся только в логе (проверка — npm run test:alert).');
}
if (!process.env.CRON_SECRET) {
  notes.push('CRON_SECRET не задан: cron-эндпоинт открыт локально, а в production вернёт 500.');
}
if (process.env.FSRS_TEST_THRESHOLD) {
  notes.push(
    `FSRS_TEST_THRESHOLD=${process.env.FSRS_TEST_THRESHOLD}: порог переоптимизации FSRS понижен.\n` +
      '    Для рабочей установки переменную надо убрать.',
  );
}
if (process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY) {
  notes.push(
    `исходящие запросы пойдут через прокси ${process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY} ` +
      '(см. src/lib/net/proxy.ts).',
  );
}

console.log(`env: OK — провайдеры: ${configuredProviders.map((k) => k.replace(/_API_KEY$/, '').toLowerCase()).join(', ')}`);
for (const note of notes) console.log(`  ! ${note}`);
