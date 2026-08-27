'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

/**
 * Подписка календаря на расписание повторений.
 *
 * Ссылка — секрет: кто ею владеет, видит расписание. Сказано прямо и рядом с
 * кнопкой, а не в справке: «поделиться календарём» — естественное действие, и
 * человек должен понимать, чем именно делится, до того как это сделает.
 *
 * Показывается только сама ссылка. Автоматической вставки в Google/Outlook
 * здесь нет: она требует OAuth-клиента, а это решение владельца (Фаза 2
 * плана). Подписка по ссылке работает во всех календарях и без него.
 */
export function CalendarFeed({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!url) {
    return (
      <p className="text-sm text-fg-muted">
        Календарная лента не настроена: в окружении нет `AUTH_SECRET`, которым подписывается
        ссылка. Без подписи лента была бы открыта любому, кто угадает адрес, — поэтому
        функция выключена целиком, а не «работает без защиты».
      </p>
    );
  }

  const webcal = url.replace(/^https?:/, 'webcal:');

  async function copy() {
    await navigator.clipboard.writeText(url!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-muted">
        Добавьте эту ссылку в свой календарь как подписку — повторения появятся событиями с
        напоминанием за 15 минут. Календарь сам перечитывает ленту, отдельно ничего делать не
        нужно.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Label className="sr-only" htmlFor="calendar-url">
          Ссылка на календарную ленту
        </Label>
        <Input id="calendar-url" readOnly value={url} className="min-w-56 flex-1 font-mono text-xs" />
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Скопировано' : 'Копировать'}
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href={webcal}>Открыть в календаре</a>
        </Button>
      </div>

      <p className="text-xs text-[var(--color-status-has-gaps)]">
        Ссылка — секрет: кто ею владеет, видит ваше расписание повторений. Не публикуйте её.
        Отзывается сменой `AUTH_SECRET` в окружении: все выданные ссылки перестают работать
        разом.
      </p>

      <p className="text-xs text-fg-subtle">
        В ленту уходят только названия узлов и сроки. Ни ответов, ни заметок, ни прочности:
        календарь у многих синхронизируется в места, о которых не думаешь, отдавая ссылку.
      </p>
    </div>
  );
}
