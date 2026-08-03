import type { Metadata, Viewport } from 'next';

import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'NeuroLearn',
  description: 'Обучение через практику до автоматизма, а не через чтение теории.',
};

export const viewport: Viewport = {
  themeColor: '#12151c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
