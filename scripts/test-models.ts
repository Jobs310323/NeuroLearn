import { writeFileSync } from 'node:fs';

import { config } from 'dotenv';
config({ path: '.env.local' });

const { configuredProviders, defaultModelRef } = await import('@/lib/ai/model-adapter');
const { formatRow, probeModel, refFromArg } = await import('./_probe-model');

/**
 * Замер конкретных моделей — в отличие от `test-providers.ts`, который берёт
 * модель по умолчанию у каждого провайдера, здесь список задаёт человек.
 *
 * Нужно перед тем, как вписывать модель в `AI_MODEL_*_FALLBACKS`: цепочка
 * резерва из непроверенных имён хуже пустой. Пустая честно падает сразу,
 * а непроверенная тратит минуты на заведомо обречённые попытки и попутно
 * набивает circuit breaker'у счётчик провалов.
 *
 * Использование:
 *   npx tsx scripts/test-models.ts deepseek:deepseek-v4-pro groq:openai/gpt-oss-120b
 *   npx tsx scripts/test-models.ts            # модели по умолчанию у всех настроенных провайдеров
 */

const OUTPUT_PATH = 'model-benchmark.json';

const args = process.argv.slice(2);
const refs =
  args.length > 0
    ? args.map(refFromArg)
    : configuredProviders().map((name) => defaultModelRef('content_generator', name));

if (refs.length === 0) {
  console.error('Нечего проверять: ни один провайдер не настроен и модели не переданы аргументами.');
  process.exit(1);
}

const results = [];
for (const ref of refs) {
  const result = await probeModel(ref);
  console.log(formatRow(result));
  results.push(result);
}

const report = {
  generatedAt: new Date().toISOString(),
  results,
};
writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

const ok = results.filter((r) => r.ok);
console.log(`\nОтвет получен от ${ok.length} из ${results.length}. Отчёт: ${OUTPUT_PATH}`);
if (ok.length > 0) {
  const fastest = ok.reduce((a, b) => (a.latencyMs <= b.latencyMs ? a : b));
  console.log(`Быстрейшая: ${fastest.ref} (${(fastest.latencyMs / 1000).toFixed(1)} с)`);
}
process.exit(ok.length === 0 ? 1 : 0);
