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

import { useTranslations } from '@/lib/i18n/provider';
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
  /** Ключ локализации. Подпись берётся из словаря, а не хранится здесь. */
  labelKey: string;
  /** Запасная подпись на случай отсутствующего перевода. */
  label: string;
  icon: typeof LayoutDashboard;
  /** Показывать в нижней панели на мобильном (там помещается 5 пунктов). */
  primary?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard' as NextRoute, labelKey: 'nav.dashboard', label: 'Обзор', icon: LayoutDashboard, primary: true },
  { href: '/paths' as NextRoute, labelKey: 'nav.paths', label: 'Пути', icon: Route, primary: true },
  { href: '/notes' as NextRoute, labelKey: 'nav.notes', label: 'Тетрадь', icon: BookOpen, primary: true },
  { href: '/review' as NextRoute, labelKey: 'nav.review', label: 'Повторение', icon: Repeat, primary: true },
  { href: '/sources' as NextRoute, labelKey: 'nav.sources', label: 'Источники', icon: FileText },
  { href: '/tutor' as NextRoute, labelKey: 'nav.tutor', label: 'Тьютор', icon: MessageCircle },
  { href: '/reflect' as NextRoute, labelKey: 'nav.reflect', label: 'Дневник', icon: BookOpen },
  { href: '/projects' as NextRoute, labelKey: 'nav.projects', label: 'Проекты', icon: FolderCheck },
  { href: '/analytics' as NextRoute, labelKey: 'nav.analytics', label: 'Аналитика', icon: BarChart3, primary: true },
  { href: '/learn' as NextRoute, labelKey: 'nav.learn', label: 'Как это работает', icon: GraduationCap },
  { href: '/settings' as NextRoute, labelKey: 'nav.settings', label: 'Настройки', icon: Settings },
];

export function AppSidebarNav() {
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <nav aria-label={t('nav.main')} className="flex flex-col gap-0.5 px-2">
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
            {translate(t, item)}
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
  const t = useTranslations();
  const items = NAV_ITEMS.filter((item) => item.primary);

  return (
    <nav
      aria-label={t('nav.main')}
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
            {translate(t, item)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Подпись пункта. Переводчик возвращает сам ключ, когда перевода нет, —
 * показывать `nav.notes` человеку хуже, чем русскую подпись из кода, поэтому
 * здесь есть запасной вариант.
 */
function translate(t: (key: string) => string, item: NavItem): string {
  const translated = t(item.labelKey);
  return translated === item.labelKey ? item.label : translated;
}
