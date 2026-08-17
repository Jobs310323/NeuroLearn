import { config } from 'dotenv';
config({ path: '.env.local' });

const {
  PROVIDER_ORDER,
  configuredProviders,
  defaultModelRef,
  primaryProvider,
  providerSpec,
} = await import('@/lib/ai/model-adapter');
const { formatRow, probeModel } = await import('./_probe-model');

/**
 * Проверка всех провайдеров разом: у каждого настроенного берётся модель по
 * умолчанию для указанного агента и делается один настоящий структурированный
 * вызов.
 *
 * Смысл — отделить «ключ не задан» от «ключ задан, но апстрим недоступен» и от
 * «апстрим доступен, но модель не держит структурированный вывод». Все три
 * случая раньше выглядели одинаково: генерация просто не работала.
 *
 * Использование:
 *   npm run test:providers
 *   npx tsx scripts/test-providers.ts tutor
 */

const agentArg = process.argv[2] ?? 'content_generator';
const AGENTS = ['content_generator', 'tutor', 'progress_analyzer', 'metacognitive_coach'] as const;
if (!(AGENTS as readonly string[]).includes(agentArg)) {
  console.error(`Неизвестный агент «${agentArg}». Допустимые: ${AGENTS.join(', ')}`);
  process.exit(1);
}
const agent = agentArg as (typeof AGENTS)[number];

const configured = configuredProviders();
const missing = PROVIDER_ORDER.filter((name) => !configured.includes(name));

console.log(`Агент: ${agent}`);
console.log(`Основной провайдер: ${primaryProvider()}`);
console.log(`Настроено: ${configured.length ? configured.join(', ') : '— ни одного'}\n`);

for (const name of missing) {
  const spec = providerSpec(name);
  console.log(`ПРОПУСК       ${name.padEnd(42)} нет ${spec.apiKeyEnv} — ключ здесь: ${spec.signupUrl}`);
}

let failures = 0;
for (const name of configured) {
  // Последовательно, не Promise.all: параллельные вызовы упираются в лимиты
  // бесплатных тарифов и дают ложные отказы по 429 вместо честной картины.
  const result = await probeModel(defaultModelRef(agent, name));
  if (!result.ok) failures++;
  console.log(formatRow(result));
}

console.log();
if (configured.length === 0) {
  console.error('Ни один провайдер не настроен: задайте хотя бы один ключ в .env.local.');
  process.exit(1);
}
console.log(`Итог: ${configured.length - failures} из ${configured.length} провайдеров отвечают.`);
// Ненулевой код только если не отвечает НИКТО: один упавший резерв — не повод
// ронять сборку, ради этого и существует цепочка.
process.exit(failures === configured.length ? 1 : 0);
