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

/** Очередь повторений: stale-while-revalidate — офлайн видно последний снимок. */
async function handleReviewQueue(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await network) ?? new Response('{"error":"offline"}', { status: 503 });
}

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
