import { BrainCircuit, LayoutDashboard, NotebookPen, Repeat, Route } from 'lucide-react';
import Link from 'next/link';

import { requireUserId } from '@/lib/auth/require-user';

const NAV = [
  { href: '/dashboard', label: 'Обзор', icon: LayoutDashboard },
  { href: '/paths', label: 'Пути', icon: Route },
  { href: '/review', label: 'Повторение', icon: Repeat },
  { href: '/reflect', label: 'Дневник', icon: NotebookPen },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUserId();

  return (
    <div className="flex min-h-dvh">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-bg-elevated/40">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-4 py-4 text-sm font-semibold tracking-tight"
        >
          <BrainCircuit className="size-4 text-accent" aria-hidden />
          NeuroLearn
        </Link>

        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
