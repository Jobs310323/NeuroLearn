'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Перезапуск вводного тура.
 *
 * Без этой кнопки «Пропустить» становится необратимым: человек закрыл тур на
 * первом экране, а через неделю захотел вернуться — и не может. Выключить
 * что-то одним кликом и не иметь способа вернуть — ловушка, а не выбор.
 */
export function RestartTour() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function restart() {
    setBusy(true);
    try {
      await fetch('/api/settings/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restart: true }),
      });
      router.push('/dashboard');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void restart()}>
      Пройти тур заново
    </Button>
  );
}
