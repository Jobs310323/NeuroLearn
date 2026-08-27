'use client';

import { Button } from '@/components/ui/button';
import { LOCALES, LOCALE_NAMES } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/provider';

/**
 * Переключатель языка. Меняет состояние немедленно и без перезагрузки —
 * словари всех трёх языков уже в памяти, отдельного запроса за переводом
 * не требуется.
 */
export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Язык интерфейса">
      {LOCALES.map((value) => (
        <Button
          key={value}
          size="sm"
          variant={value === locale ? 'default' : 'secondary'}
          aria-pressed={value === locale}
          onClick={() => setLocale(value)}
        >
          {LOCALE_NAMES[value]}
        </Button>
      ))}
    </div>
  );
}
