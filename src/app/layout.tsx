import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale } from '@/lib/i18n/config';

import { Providers } from './providers';
import { ServiceWorkerRegister } from './sw-register';
import './globals.css';

export const metadata: Metadata = {
  title: 'NeuroLearn',
  description: 'Обучение через практику до автоматизма, а не через чтение теории.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#12151c',
};

/**
 * Язык определяется здесь один раз за запрос: сначала явный выбор человека
 * (cookie), иначе — `Accept-Language`. Сегмента `[locale]` в маршрутах нет
 * намеренно: он потребовал бы middleware, а глобального middleware в проекте
 * нет по инварианту авторизации.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const stored = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored)
    ? stored
    : negotiateLocale((await headers()).get('accept-language'));

  return (
    <html lang={locale ?? DEFAULT_LOCALE} suppressHydrationWarning>
      <body>
        <ServiceWorkerRegister />
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
