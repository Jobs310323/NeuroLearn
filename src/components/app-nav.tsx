'use client';

import {
  BarChart3,
  BookOpen,
  FileText,
  FolderCheck,
  GraduationCap,
  LayoutDashboard,
  MessageCircle,
  Repeat,
  Route,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route as NextRoute } from 'next';

import { isActiveNav } from '@/lib/nav/active';
import { cn } from '@/lib/utils';

/**
 * Навигация приложения: боковая колонка на десктопе, нижняя панель на мобильном.
 *
 * Клиентский компонент нужен ровно ради одного — подсветки активного пункта:
 * без неё человек не понимает, где он находится, а после перехода по
 * ⌘K-палитре это единственная обратная связь о том, что переход состоялся.
 * Активность помечается не только цветом (`aria-current="page"` + вертикальная
 * метка), иначе пункт неразличим для screen reader и при дальтонизме.
 */

export type NavItem = {
  href: NextRoute;
  label: string;
  icon: typeof LayoutDashboard;
  /** Показывать в нижней панели на мобильном (там помещается 5 пунктов). */
  primary?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard' as NextRoute, label: 'Обзор', icon: LayoutDashboard, primary: true },
  { href: '/paths' as NextRoute, label: 'Пути', icon: Route, primary: true },
  { href: '/notes' as NextRoute, label: 'Тетрадь', icon: BookOpen, primary: true },
  { href: '/review' as NextRoute, label: 'Повторение', icon: Repeat, primary: true },
  { href: '/sources' as NextRoute, label: 'Источники', icon: FileText },
  { href: '/tutor' as NextRoute, label: 'Тьютор', icon: MessageCircle },
  { href: '/reflect' as NextRoute, label: 'Дневник', icon: BookOpen },
  { href: '/projects' as NextRoute, label: 'Проекты', icon: FolderCheck },
  { href: '/analytics' as NextRoute, label: 'Аналитика', icon: BarChart3, primary: true },
  { href: '/learn' as NextRoute, label: 'Как это работает', icon: GraduationCap },
  { href: '/settings' as NextRoute, label: 'Настройки', icon: Settings },
];

export function AppSidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Основная навигация" className="flex flex-col gap-0.5 px-2">
      {NAV_ITEMS.map((item) => {
        const active = isActiveNav(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              active
                ? 'bg-bg-hover font-medium text-fg'
                : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
            )}
          >
            {active ? (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
              />
            ) : null}
            <item.icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Нижняя панель мобильного. Цели касания — 56×44 и больше (рекомендация WCAG
 * 2.5.5 и практический минимум 44px из плана мобильного UX).
 */
export function AppBottomNav() {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => item.primary);

  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-bg-elevated/95 backdrop-blur md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => {
        const active = isActiveNav(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] transition-colors',
              active ? 'text-fg' : 'text-fg-subtle',
            )}
          >
            <span className="relative flex items-center justify-center">
              {active ? (
                <span
                  aria-hidden
                  className="absolute -top-2 h-0.5 w-6 rounded-full bg-accent"
                />
              ) : null}
              <item.icon className="size-5" aria-hidden />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
