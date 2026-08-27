import { and, eq } from 'drizzle-orm';

import { PushRemindersToggle } from '@/components/push-reminders-toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUserId } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';
import { calendarToken } from '@/lib/services/calendar/token';
import { trackerStatus } from '@/lib/monitoring/tracker';
import { budgetState, CATEGORY_LABEL } from '@/lib/services/push/budget';
import { pushLog } from '@/lib/db/schema';
import { desc, gte } from 'drizzle-orm';

import { CalendarFeed } from './calendar-feed';
import { HintSettings } from './hint-settings';
import { LocaleSwitcher } from './locale-switcher';
import { NotebookPrivacy } from './notebook-privacy';
import { PushDevices } from './push-devices';
import { RestartTour } from './restart-tour';

export const metadata = { title: 'Настройки — NeuroLearn' };

/**
 * Настройки. Здесь собрано то, что человек должен уметь выключить: доставку
 * уведомлений на конкретное устройство и внешний трекинг ошибок.
 *
 * Состояние трекинга показывается честно — включён он или нет и почему. Тихо
 * выключенная телеметрия хуже отсутствующей: про неё думают, что она работает.
 */
export default async function SettingsPage() {
  const userId = await requireUserId();
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true, preferences: true },
  });
  const tracking = trackerStatus();
  const aiOnNotes = withPreferenceDefaults(user?.preferences).aiOnNotes;

  // Бюджет тишины показывается человеку, а не только соблюдается сервером:
  // ограничение, о котором нельзя узнать, ничем не отличается от его
  // отсутствия.
  const sentRecords = await db
    .select({ category: pushLog.category, at: pushLog.sentAt })
    .from(pushLog)
    .where(
      and(
        eq(pushLog.userId, userId),
        eq(pushLog.delivered, true),
        gte(pushLog.sentAt, new Date(Date.now() - 7 * 86_400_000)),
      ),
    )
    .orderBy(desc(pushLog.sentAt));
  const budget = budgetState(sentRecords);

  const secret = process.env.AUTH_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const calendarUrl =
    secret && appUrl ? `${appUrl}/api/calendar/${calendarToken(userId, secret)}.ics` : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-medium">Настройки</h1>
        <p className="mt-1 text-sm text-fg-muted">{user?.email}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Напоминания о повторениях</CardTitle>
          <CardDescription>
            Push приходит, когда подошёл срок повторения по расписанию FSRS. Отдельно от
            этого никаких уведомлений нет.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PushRemindersToggle />
          <PushDevices />

          <div>
            <p className="text-sm text-fg">Бюджет тишины</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Сколько уведомлений каждой категории приложение может себе позволить за
              неделю. Ограничение защищает не вас от приложения, а сам канал: уведомления
              работают, пока их читают.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {budget.map((state) => (
                <li
                  key={state.category}
                  className="flex items-baseline justify-between gap-3 text-xs"
                >
                  <span className="text-fg-muted">{CATEGORY_LABEL[state.category]}</span>
                  <span className="tabular-nums text-fg-subtle">
                    {state.used} из {state.limit} за неделю
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Календарь повторений</CardTitle>
          <CardDescription>
            Подписка по ссылке, без OAuth и без доступа к вашему календарю: приложение
            только отдаёт файл, календарь его читает.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CalendarFeed url={calendarUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Язык интерфейса</CardTitle>
          <CardDescription>
            Переключается сразу, без перезагрузки. Выбор сохраняется в профиле и переезжает
            вместе с ним на другие устройства.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LocaleSwitcher />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Умные подсказки</CardTitle>
          <CardDescription>
            Наблюдения по ходу практики. Детерминированные правила поверх телеметрии текущей
            сессии — модель к ним не подключена и работают они при любом состоянии провайдеров.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HintSettings />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Тетрадь и AI</CardTitle>
          <CardDescription>
            Заметки — самый личный текст в приложении. По умолчанию модель их не видит.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotebookPrivacy initialEnabled={aiOnNotes} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Вводный тур</CardTitle>
          <CardDescription>
            Пять шагов по тому, как устроено приложение и почему практика намеренно
            неудобна. Пропуск сохраняется — тур не всплывёт сам во второй раз.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RestartTour />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Трекинг ошибок</CardTitle>
          <CardDescription>
            Внешний приёмник получает только техническую ошибку и место в коде. Тексты
            ответов, заметок и рефлексий туда не уходят.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-fg-muted">
          {tracking.enabled ? (
            <p>
              Включён: <span className="text-fg">{tracking.host}</span>, проект{' '}
              <span className="tabular-nums text-fg">{tracking.projectId}</span>, окружение{' '}
              <span className="text-fg">{tracking.environment}</span>.
            </p>
          ) : (
            <p>
              Выключен —{' '}
              {tracking.reason === 'no_dsn'
                ? 'ERROR_TRACKING_DSN не задан.'
                : 'ERROR_TRACKING_DSN задан, но не разбирается как DSN.'}{' '}
              Ошибки остаются в логах сервера.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
