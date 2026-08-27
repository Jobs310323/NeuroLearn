import { BrainCircuit } from 'lucide-react';
import Link from 'next/link';

import { AppBottomNav, AppSidebarNav } from '@/components/app-nav';
import { CommandPalette } from '@/components/command-palette';
import { Starfield } from '@/components/starfield';
import { requireUserId } from '@/lib/auth/require-user';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUserId();

  return (
    <div className="flex min-h-dvh">
      {/* Декоративный слой под всем интерфейсом: ничего не сообщает, не
          ловит события и отключается при prefers-reduced-motion. */}
      <Starfield />

      {/* Пропуск навигации — первое, что получает фокус с клавиатуры. Без него
          человек на клавиатуре проходит десять пунктов меню на каждой странице. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-bg-elevated focus:px-3 focus:py-2 focus:text-sm"
      >
        Перейти к содержимому
      </a>

      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-bg-elevated/40 md:flex">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-4 py-4 text-sm font-semibold tracking-tight"
        >
          <BrainCircuit className="size-4 text-accent" aria-hidden />
          NeuroLearn
        </Link>

        <AppSidebarNav />
      </aside>

      <main id="main" className="min-w-0 flex-1 pb-16 md:pb-0">
        {children}
      </main>

      <AppBottomNav />
      {/* Захват из любого места одним жестом: ⌘K → «Записать». Мысль, ради
          которой надо дойти до раздела, забывается по дороге. */}
      <CommandPalette />
    </div>
  );
}
