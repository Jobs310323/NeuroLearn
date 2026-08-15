/**
 * Подбор бесплатных моделей OpenRouter, пригодных для агентов.
 * Нужны поддержка инструментов и структурированного вывода — иначе Zod-контракт
 * генератора контента не выполнить.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

type Model = {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
};

// Каталог моделей открыт. User-Agent обязателен: без него запрос отсекает
// защита периметра OpenRouter (403 ещё до проверки ключа).
const res = await fetch('https://openrouter.ai/api/v1/models', {
  headers: { 'User-Agent': 'NeuroLearn/0.1 (+http://localhost:3200)' },
});
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  console.error([...res.headers].slice(0, 12).map(([k, v]) => `${k}: ${v}`).join('\n'));
  console.error((await res.text()).slice(0, 400));
  process.exit(1);
}

const { data } = (await res.json()) as { data: Model[] };

const free = data
  .filter((m) => Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)
  .map((m) => ({
    id: m.id,
    ctx: m.context_length,
    tools: m.supported_parameters?.includes('tools') ?? false,
    structured: m.supported_parameters?.includes('structured_outputs') ?? false,
  }))
  .sort((a, b) => Number(b.tools) - Number(a.tools) || b.ctx - a.ctx);

console.log(`Всего бесплатных: ${free.length}`);
console.log('--- инструменты + структурированный вывод ---');
for (const m of free.filter((m) => m.tools && m.structured).slice(0, 12)) {
  console.log(`${m.id}  ctx=${m.ctx}`);
}
console.log('--- только инструменты ---');
for (const m of free.filter((m) => m.tools && !m.structured).slice(0, 8)) {
  console.log(`${m.id}  ctx=${m.ctx}`);
}

// Проверка ключа отдельным дешёвым запросом.
const key = process.env.OPENROUTER_API_KEY;
if (key) {
  const auth = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${key}` },
  });
  console.log(`--- ключ: HTTP ${auth.status} ---`);
  console.log((await auth.text()).slice(0, 300));
}
