import { eq } from 'drizzle-orm';
import { BookOpen, FlaskConical, Pencil, Play } from 'lucide-react';
import Link from 'next/link';

import { GlossaryTerm } from '@/components/glossary-term';
import { ScienceHint } from '@/components/science-hint';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OnboardingTour } from '@/features/onboarding/components/onboarding-tour';
import { requireUserId } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { listPaths } from '@/lib/db/queries/paths';
import { getTodayView } from '@/lib/db/queries/today';
import { masteryLabel } from '@/lib/services/learner/mastery';
import { users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';
import { formatDueDate } from '@/lib/utils';

export default async function DashboardPage() {
  const userId = await requireUserId();

  const [paths, today, user] = await Promise.all([
    listPaths(userId),
    getTodayView(userId),
    db.query.users.findFirst({ where: eq(users.id, userId), columns: { preferences: true } }),
  ]);

  const onboarding = withPreferenceDefaults(user?.preferences).onboarding;
  const showTour = !onboarding.completed && !onboarding.skipped;

  const totalNodes = paths.reduce((sum, p) => sum + p.nodeCount, 0);
  const automated = paths.reduce((sum, p) => sum + p.automatedCount, 0);
  const mastered = paths.reduce((sum, p) => sum + p.masteredCount, 0);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-8 md:py-10">
      {showTour ? <OnboardingTour initialStep={onboarding.lastStep} /> : null}

      <h1 className="text-2xl font-semibold tracking-tight">Обзор</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Прогресс измеряется <GlossaryTerm term="automaticity">автоматизмом</GlossaryTerm>, а не
        количеством пройденных материалов.
      </p>

      {/* Быстрые действия впереди статистики: экран открывают, чтобы начать
          заниматься, а не чтобы посмотреть на числа. */}
      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Быстрые действия">
        <Button size="sm" asChild>
          <Link href="/review">
            <Play aria-hidden />
            Продолжить практику
          </Link>
        </Button>
        <Button size="sm" variant="secondary" asChild>
          <Link href="/notes">
            <Pencil aria-hidden />
            Записать мысль
          </Link>
        </Button>
        <Button size="sm" variant="secondary" asChild>
          <Link href="/paths/new">
            <BookOpen aria-hidden />
            Новый путь
          </Link>
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/analytics">
            <FlaskConical aria-hidden />
            Эксперимент
          </Link>
        </Button>
      </nav>

      <TodaySection today={today} />

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Путей" value={paths.length} />
        <Stat label="Узлов знаний" value={totalNodes} />
        <Stat
          label="Доведено до автоматизма"
          value={automated}
          hint={<ScienceHint citation="automaticity" />}
        />
      </div>

      {totalNodes > 0 ? (
        <Card className="mt-4">
          <CardContent className="p-5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-fg-muted">Шкала мастерства по пути</span>
              <span className="text-fg">
                {masteryLabel(Math.round(((mastered + automated) / totalNodes) * 100)).label}
              </span>
            </div>
            <p className="mt-1 text-xs text-fg-subtle">
              {masteryLabel(Math.round(((mastered + automated) / totalNodes) * 100)).description}{' '}
              Это подпись к измеренной{' '}
              <GlossaryTerm term="strength">прочности</GlossaryTerm>, а не уровень: она ни к
              чему не открывает доступ и ни с кем не сравнивается.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Пути обучения</h2>
          <Button asChild size="sm">
            <Link href="/paths/new">Новый путь</Link>
          </Button>
        </div>

        {paths.length === 0 ? (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Пока пусто</CardTitle>
              <CardDescription>
                Начните с цели: чему именно нужно научиться и до какого уровня.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/paths/new">Поставить цель</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="mt-4 grid gap-3">
            {paths.map((path) => (
              <li key={path.id}>
                <Link href={`/paths/${path.id}`} className="block">
                  <Card className="transition-colors hover:bg-bg-hover">
                    <CardHeader>
                      <CardTitle>{path.title}</CardTitle>
                      <CardDescription className="line-clamp-2">{path.goal}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-xs text-fg-subtle">
                      {path.nodeCount} узлов · освоено {path.masteredCount} · автоматизм{' '}
                      {path.automatedCount}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * «Сегодня»: что подошло по сроку и сколько это займёт.
 *
 * Рядом с каждым числом стоит, из чего оно выведено. Дашборд, показывающий
 * «рекомендуемое время» без объяснения, воспитывает доверие к цифре вместо
 * понимания собственного обучения.
 */
function TodaySection({ today }: { today: Awaited<ReturnType<typeof getTodayView>> }) {
  if (today.cards.length === 0 && today.dueNotes.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>На сегодня ничего не подошло</CardTitle>
          <CardDescription>
            Пустая очередь — это не простой, а работающее расписание:{' '}
            <GlossaryTerm term="fsrs">FSRS</GlossaryTerm> ставит повторение на грань
            забывания, и приходить раньше срока незачем.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Сегодня</CardTitle>
        <CardDescription>
          {today.cards.length > 0
            ? `Подошло по сроку: ${today.cards.length}. Примерно ${today.recommendedMinutes} мин — это сумма оценок по узлам, ограниченная вашей дневной целью (${today.dailyGoalMinutes} мин). Остальное подождёт до завтра.`
            : 'Заданий по сроку нет, но есть заметки, к которым пора вернуться.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {today.cards.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {today.cards.slice(0, 6).map((card) => (
              <li key={card.nodeId}>
                <Link
                  href={`/paths/${card.pathId}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5 text-sm transition-colors hover:bg-bg-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-fg">{card.nodeTitle}</span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {card.pathTitle} · прочность {card.knowledgeStrength}
                    </span>
                  </span>
                  <span
                    className={
                      card.overdueDays > 0
                        ? 'shrink-0 text-xs text-[var(--color-status-needs-review)]'
                        : 'shrink-0 text-xs text-fg-subtle'
                    }
                  >
                    {formatDueDate(new Date(card.due))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {today.dueNotes.length > 0 ? (
          <div>
            <p className="text-xs font-medium text-fg">Перечитать перед практикой</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {today.dueNotes.map((note) => (
                <li key={note.noteId} className="text-xs">
                  <Link href={`/notes?note=${note.noteId}`} className="text-fg-muted hover:underline">
                    {note.title}
                  </Link>
                  {note.isCapsule ? (
                    <span className="ml-1.5 text-[var(--color-status-needs-review)]">
                      капсула вернулась
                    </span>
                  ) : note.nodeTitle ? (
                    <span className="ml-1.5 text-fg-subtle">· {note.nodeTitle}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {today.forecast ? (
          <p className="border-t border-border pt-3 text-xs text-fg-subtle">
            {today.forecast.nodesPerWeek === null ? (
              <>
                Прогноз по «{today.forecast.pathTitle}» появится после первых сессий: он
                строится по фактическому темпу, а не по плановым оценкам времени. Осталось
                узлов: {today.forecast.remainingNodes}.
              </>
            ) : (
              <>
                По «{today.forecast.pathTitle}» осталось {today.forecast.remainingNodes} узлов.
                При темпе последней недели ({today.sessionsLastWeek} сессий) это примерно{' '}
                {new Date(today.forecast.estimatedDate!).toLocaleDateString('ru-RU')}. Прогноз
                считается по факту и меняется вместе с темпом.
              </>
            )}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-1.5 text-xs text-fg-muted">
          {label}
          {hint}
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
