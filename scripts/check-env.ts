import { config } from 'dotenv';
import { z } from 'zod';

config({ path: '.env.local' });

/**
 * Проверка формы секретов перед `dev`/`build` — не значения (сверять не с чем),
 * а формата: опечатка при ручной ротации ловится здесь, а не превращается
 * в `AiNotConfiguredError` посреди многоминутной генерации.
 */

/** В `.env.local` незаполненный секрет — пустая строка, не отсутствующий ключ. */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, 'должен начинаться с postgres(ql)://'),
  AUTH_SECRET: z.string().min(32, 'короче 32 символов — сгенерировать заново'),
  AUTH_OWNER_EMAIL: z.string().email('не похоже на e-mail'),
  AUTH_OWNER_PASSWORD: z.string().min(8, 'короче 8 символов'),
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['openrouter', 'google'])).default('openrouter'),
  OPENROUTER_API_KEY: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^sk-or-v1-[a-f0-9]{64}$/, 'не похож на текущий формат ключа OpenRouter').optional(),
  ),
  GOOGLE_GENERATIVE_AI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(20).optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Проверка .env провалена:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const { AI_PROVIDER, OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY } = parsed.data;

if (AI_PROVIDER === 'google' && !GOOGLE_GENERATIVE_AI_API_KEY) {
  console.error('AI_PROVIDER=google, но GOOGLE_GENERATIVE_AI_API_KEY не задан.');
  process.exit(1);
}
if (AI_PROVIDER === 'openrouter' && !OPENROUTER_API_KEY) {
  console.error('AI_PROVIDER=openrouter, но OPENROUTER_API_KEY не задан.');
  process.exit(1);
}

console.log('env: OK');
