const CACHE_VERSION = 'v1';
const SHELL_CACHE = `neurolearn-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `neurolearn-runtime-${CACHE_VERSION}`;

const SHELL_URLS = ['/offline', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Навигации: сеть первой, при обрыве — офлайн-страница. */
async function handleNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    return cached ?? (await caches.match('/offline'));
  }
}

/** Статика Next (`_next/static`): неизменяемые файлы — можно cache-first. */
async function handleStaticAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Очередь повторений: stale-while-revalidate — офлайн видно последний снимок.
 *
 * Ответ авторизованный, поэтому потеря сессии обязана стирать снимок. Иначе
 * `cached ?? network` продолжал бы отдавать учебные данные из Cache Storage
 * после того, как сервер перестал их отдавать: сессии нет, а очередь на экране
 * есть. Диск переживает и выход, и закрытие браузера.
 */
async function handleReviewQueue(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      } else if (response.status === 401 || response.status === 403) {
        await cache.delete(request);
      }
      return response;
    })
    .catch(() => null);

  // Сначала сеть, если она есть: только её ответ говорит, действительна ли
  // ещё сессия. Кэш — запасной путь для настоящего офлайна.
  const fresh = await network;
  if (fresh) {
    if (fresh.status === 401 || fresh.status === 403) return fresh;
    if (fresh.ok) return fresh;
  }
  return cached ?? fresh ?? new Response('{"error":"offline"}', { status: 503 });
}

/**
 * Ручная очистка снимков. Вызывать при выходе из аккаунта:
 *   navigator.serviceWorker.controller?.postMessage({ type: 'clear-runtime-cache' })
 *
 * Кнопки выхода в приложении сейчас нет, поэтому канал пока не используется —
 * но без него будущий выход не смог бы дотянуться до Cache Storage: страница
 * и service worker живут в разных контекстах.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'clear-runtime-cache') {
    event.waitUntil(caches.delete(RUNTIME_CACHE));
  }
});

/**
 * Web Push: показать напоминание о повторении. Payload — JSON от
 * `src/lib/services/push/send.ts` ({ title, body, url }). Молчаливо
 * игнорировать не-JSON payload — рассылка чужого формата не должна ронять
 * обработчик.
 */
self.addEventListener('push', (event) => {
  let data = { title: 'NeuroLearn', body: 'Пора повторить материал.', url: '/review' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload не JSON — используем значения по умолчанию.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.svg',
      data: { url: data.url },
    }),
  );
});

/** Клик по уведомлению — открыть очередь повторений (или сфокусировать уже открытую вкладку). */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/review';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(handleStaticAsset(request));
    return;
  }
  if (url.pathname === '/api/review/queue') {
    event.respondWith(handleReviewQueue(request));
  }
});
