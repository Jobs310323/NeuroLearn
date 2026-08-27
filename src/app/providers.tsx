'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { useState, type ReactNode } from 'react';

import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config';
import { I18nProvider } from '@/lib/i18n/provider';

export function Providers({
  children,
  locale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  locale?: Locale;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Данные обучения меняются только по действиям пользователя —
            // агрессивный refetch не нужен, а мгновенность даёт кэш.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
