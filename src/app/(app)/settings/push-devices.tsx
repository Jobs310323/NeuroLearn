'use client';

import { Check, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Device = {
  id: string;
  label: string;
  autoLabel: string;
  endpointTail: string;
  createdAt: string;
  lastSeenAt: string;
};

/**
 * Список push-подписок с переименованием и отзывом.
 *
 * Отзыв — необратимое действие с последствием («это устройство перестанет
 * получать напоминания»), поэтому подтверждается, а не срабатывает с первого
 * клика.
 */
export function PushDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/push/devices');
      if (!res.ok) throw new Error('Не удалось загрузить список устройств');
      const body = await res.json();
      setDevices(body.devices);
      setConfigured(body.pushConfigured);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сеть недоступна');
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rename(id: string) {
    const label = draft.trim();
    if (!label) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/push/devices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error('Не удалось переименовать');
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сеть недоступна');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string, label: string) {
    if (!window.confirm(`Отозвать подписку «${label}»? Устройство перестанет получать напоминания.`)) {
      return;
    }
    setBusy(id);
    try {
      const res = await fetch(`/api/push/devices/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Не удалось отозвать подписку');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сеть недоступна');
    } finally {
      setBusy(null);
    }
  }

  if (devices === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Загружаю устройства…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!configured ? (
        <p className="rounded-md border border-border bg-bg p-3 text-xs text-fg-muted">
          Ключи VAPID не заданы, push-уведомления выключены на уровне сервера. Подписки ниже
          сохранятся, но доставки не будет, пока ключи не появятся в окружении.
        </p>
      ) : null}

      {error ? <p className="text-xs text-amber-400">{error}</p> : null}

      {devices.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Подписок нет. Включите напоминания на устройстве, с которого хотите их получать.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {devices.map((device) => (
            <li
              key={device.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg p-3"
            >
              {editing === device.id ? (
                <>
                  <label className="sr-only" htmlFor={`label-${device.id}`}>
                    Имя устройства
                  </label>
                  <Input
                    id={`label-${device.id}`}
                    value={draft}
                    maxLength={60}
                    onChange={(e) => setDraft(e.target.value)}
                    className="h-8 max-w-56 flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={busy === device.id}
                    onClick={() => void rename(device.id)}
                  >
                    <Check aria-hidden />
                    Сохранить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Отмена
                  </Button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">{device.label}</p>
                    <p className="text-[11px] text-fg-subtle">
                      {device.autoLabel} · …{device.endpointTail} · подписано{' '}
                      {new Date(device.createdAt).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Переименовать ${device.label}`}
                    onClick={() => {
                      setEditing(device.id);
                      setDraft(device.label);
                    }}
                  >
                    <Pencil aria-hidden />
                    Переименовать
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === device.id}
                    aria-label={`Отозвать подписку ${device.label}`}
                    onClick={() => void revoke(device.id, device.label)}
                  >
                    <Trash2 aria-hidden />
                    Отозвать
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
