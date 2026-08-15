/** Проверка гипотезы: Cloudflare OpenRouter отсекает TLS-отпечаток Node. */
import { request } from 'node:https';

const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function probe(label: string, ciphers?: string): Promise<void> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: 'openrouter.ai',
        path: '/api/v1/models',
        method: 'GET',
        ciphers,
        ...(ciphers ? { sigalgs: 'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256' } : {}),
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        },
      },
      (res) => {
        console.log(`${label}: HTTP ${res.statusCode}`);
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', (error) => {
      console.log(`${label}: ошибка ${error.message}`);
      resolve();
    });
    req.end();
  });
}

await probe('по умолчанию');
await probe('порядок шифров Chrome', CHROME_CIPHERS);
