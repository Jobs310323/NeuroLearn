'use client';

import { useEffect } from 'react';

import { flushPendingGrades, registerSyncOnReconnect } from '@/lib/offline/sync';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Ошибку регистрации нельзя гасить молча: без service worker'а офлайн-режим
    // просто не работает, а внешне приложение выглядит здоровым. Браузер
    // отказывает и по причинам, не зависящим от кода (выключенные SW в профиле,
    // приватный режим), — поэтому сообщение в консоль, а не исключение.
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('Service worker не зарегистрирован, офлайн-режим недоступен:', error);
    });
    registerSyncOnReconnect();
    if (navigator.onLine) void flushPendingGrades();
  }, []);

  return null;
}
