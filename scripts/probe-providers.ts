/** Проверка сетевой доступности провайдеров ИИ из Node на этой машине. */
export {};

const targets = [
  ['OpenRouter', 'https://openrouter.ai/api/v1/models'],
  ['Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/models'],
  ['Groq', 'https://api.groq.com/openai/v1/models'],
  ['Anthropic', 'https://api.anthropic.com/v1/models'],
  ['Mistral', 'https://api.mistral.ai/v1/models'],
] as const;

for (const [name, url] of targets) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.text()).slice(0, 120).replace(/\s+/g, ' ');
    console.log(`${name}: HTTP ${res.status} — ${body}`);
  } catch (error) {
    console.log(`${name}: недоступен — ${(error as Error).message}`);
  }
}
