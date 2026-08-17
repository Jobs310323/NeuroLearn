import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

/**
 * Заставляет `fetch` в Node ходить через прокси из переменных окружения.
 *
 * Node не читает `HTTP_PROXY`/`HTTPS_PROXY` сам: их понимают curl, git, npm и
 * браузер, но встроенный `fetch` (undici) по умолчанию идёт напрямую. На машине,
 * где выход в интернет организован через локальный прокси, это выглядит как
 * блокировка со стороны провайдера моделей, а не как своя настройка:
 *
 *   curl  -> api.groq.com   HTTP 200
 *   fetch -> api.groq.com   HTTP 403 Forbidden
 *
 * Один и тот же ключ, один и тот же адрес. Именно на этом расхождении родился
 * прежний диагноз «Cloudflare отсекает TLS-отпечаток Node» — он был неверен:
 * запросы просто уходили мимо прокси. То же самое объясняет 403 у OpenRouter
 * и таймауты у Mistral.
 *
 * Ничего не «обходит»: используется тот же прокси, что уже настроен в системе,
 * заголовки и TLS-стек остаются штатными.
 *
 * Без заданных переменных `EnvHttpProxyAgent` работает как обычный агент, так
 * что на Vercel (где прокси нет) вызов безвреден и ничего не меняет.
 */

let installed = false;

export function enableEnvProxy(): void {
  if (installed) return;
  installed = true;

  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (!proxy) return;

  setGlobalDispatcher(new EnvHttpProxyAgent());
}
