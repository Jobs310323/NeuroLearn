'use client';

import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Включает/выключает Web Push напоминания об отложенных повторениях
 * (F: пробел №8 в аналитическом промте — до этого напоминаний не было
 * вовсе, только пассивная очередь на экране).
 *
 * Требует `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — без него кнопка сама себя
 * отключает, не притворяясь рабочей.
 */
export function PushRemindersToggle() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setSupported(true);

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setSubscribed(sub !== null))
      .catch(() => {});
  }, []);

  async function subscribe() {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // applicationServerKey принимает base64url-строку напрямую (Push API,
      // без ручного декодирования в Uint8Array) — так проще и без проблем с
      // типизацией BufferSource в разных версиях lib.dom.
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      const json = subscription.toJSON();

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setSubscribed(true);
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        });
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void (subscribed ? unsubscribe() : subscribe())}>
      {subscribed ? <BellOff aria-hidden /> : <Bell aria-hidden />}
      {subscribed ? 'Выключить напоминания' : 'Напоминать о повторениях'}
    </Button>
  );
}
