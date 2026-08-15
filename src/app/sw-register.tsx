'use client';

import { useEffect } from 'react';

import { flushPendingGrades, registerSyncOnReconnect } from '@/lib/offline/sync';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    registerSyncOnReconnect();
    if (navigator.onLine) void flushPendingGrades();
  }, []);

  return null;
}
