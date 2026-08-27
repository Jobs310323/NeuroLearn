import { and, asc, eq, lte } from 'drizzle-orm';

import { apiError } from '@/lib/api/respond';
import { db } from '@/lib/db';
import { fsrsCards, knowledgeNodes, learningPaths, users } from '@/lib/db/schema';
import { buildIcs, type CalendarEvent } from '@/lib/services/calendar/ics';
import { verifyCalendarToken } from '@/lib/services/calendar/token';

/**
 * Лента повторений в формате iCalendar.
 *
 * Единственный маршрут приложения без сессии — и это вынужденно: календарные
 * клиенты не умеют логиниться, они ходят по ссылке фоновым процессом. Защита
 * подписью вместо сессии — `services/calendar/token.ts`.
 *
 * Наружу отдаются только названия узлов и сроки. Ни ответов, ни заметок, ни
 * прочности: календарь у многих синхронизируется в места, о которых человек
 * не думает, отдавая ссылку.
 */

/** Горизонт ленты: дальше двух недель расписание всё равно пересчитается. */
const HORIZON_DAYS = 14;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Без секрета подписать токен нечем. Молча отдавать ленту кому угодно —
    // не вариант, поэтому функция честно выключена.
    return apiError('DISABLED', 'Календарная лента не настроена: нет AUTH_SECRET.');
  }

  const { token } = await params;
  const userId = verifyCalendarToken(token.replace(/\.ics$/, ''), secret);
  if (!userId) return apiError('NOT_FOUND', 'Лента не найдена.');

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, dailyGoalMinutes: true },
  });
  if (!user) return apiError('NOT_FOUND', 'Лента не найдена.');

  const horizon = new Date(Date.now() + HORIZON_DAYS * 86_400_000);

  const rows = await db
    .select({
      nodeId: knowledgeNodes.id,
      title: knowledgeNodes.title,
      pathId: learningPaths.id,
      estimatedMinutes: knowledgeNodes.estimatedMinutes,
      due: fsrsCards.due,
    })
    .from(fsrsCards)
    .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, fsrsCards.nodeId))
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(and(eq(fsrsCards.userId, userId), lte(fsrsCards.due, horizon)))
    .orderBy(asc(fsrsCards.due))
    .limit(200);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';

  const events: CalendarEvent[] = rows.map((row) => ({
    // UID стабилен по узлу: пересчёт расписания должен ДВИГАТЬ событие в
    // календаре, а не создавать второе рядом.
    uid: `${row.nodeId}@neurolearn`,
    start: row.due,
    durationMinutes: Math.max(5, Math.min(60, row.estimatedMinutes)),
    summary: `Повторение: ${row.title}`,
    description: 'Срок по расписанию FSRS. Раньше срока приходить незачем.',
    url: base ? `${base}/paths/${row.pathId}` : undefined,
  }));

  return new Response(buildIcs({ name: 'NeuroLearn — повторения', events }), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="neurolearn.ics"',
      // Лента живая: кэшировать её на стороне клиента нельзя, иначе календарь
      // неделю показывает вчерашнее расписание.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export const dynamic = 'force-dynamic';
