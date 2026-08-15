import { config } from 'dotenv';

config({ path: '.env.local' });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const variants: { name: string; headers: Record<string, string> }[] = [
  { name: 'плейн', headers: {} },
  { name: 'только UA', headers: { 'User-Agent': UA } },
  {
    name: 'браузерный набор',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      Referer: 'https://openrouter.ai/',
      Origin: 'https://openrouter.ai',
      'sec-ch-ua': '"Chromium";v="141", "Not?A_Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
  },
];

for (const variant of variants) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: variant.headers,
    });
    console.log(`${variant.name}: HTTP ${res.status}`);
  } catch (error) {
    console.log(`${variant.name}: ошибка ${(error as Error).message}`);
  }
}

const key = process.env.OPENROUTER_API_KEY;
if (key) {
  const res = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${key}`, 'User-Agent': UA },
  });
  console.log(`проверка ключа: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}
