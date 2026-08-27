'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Разрешение AI работать с содержимым тетради.
 *
 * Выключено по умолчанию и включается только явным действием. Формулировка на
 * кнопке нарочно называет последствие («текст заметок будет отправляться
 * провайдеру»), а не выгоду: включая это, человек соглашается отдать свой
 * личный текст стороннему сервису, и решение должно приниматься с этим
 * знанием, а не с обещанием умного поиска.
 *
 * Без разрешения тетрадь функциональна полностью: поиск, фильтры, связи,
 * живые заметки и экспорт — всё детерминированное.
 */
export function NotebookPrivacy({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !enabled;
    if (
      next &&
      !window.confirm(
        'Включить AI по заметкам? Текст заметок будет отправляться выбранному провайдеру модели для авто-тегов, суммаризации и семантического поиска. Отключить можно в любой момент.',
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/settings/notebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiOnNotes: next }),
      });
      if (res.ok) setEnabled(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg">
          AI по заметкам: <span className="text-fg-muted">{enabled ? 'включён' : 'выключен'}</span>
        </p>
        <Button size="sm" variant="secondary" disabled={busy} aria-pressed={enabled} onClick={() => void toggle()}>
          {enabled ? 'Выключить' : 'Включить'}
        </Button>
      </div>
      <p className="text-xs text-fg-subtle">
        Без него работают поиск, фильтры, связи, живые заметки и экспорт — всё
        детерминированное. Обработанные модели заметки помечаются бейджем с датой.
      </p>
    </div>
  );
}
