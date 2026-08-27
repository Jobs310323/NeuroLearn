import { and, asc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import {
  fsrsCards,
  knowledgeNodes,
  learningExperiments,
  nodeProgress,
  notes,
  pushLog,
  pushSubscriptions,
} from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';
import { logError } from '@/lib/monitoring/logger';
import { selectSendable, type Candidate, type PushCategory } from '@/lib/services/push/budget';
import {
  capsuleMessage,
  experimentReadyMessage,
  nodeWeakMessage,
  reviewDueMessage,
  type ReminderPayload,
} from '@/lib/services/push/reminders';
import { sendPush } from '@/lib/services/push/send';

/**
 * Vercel Cron: напоминания.
 *
 * Политика прежняя — «напоминать, когда есть что напоминать»: рассылка идёт
 * от состояния данных, а не по расписанию вслепую. Добавились три категории
 * (просевший узел, готовый эксперимент, вернувшаяся капсула) и бюджет тишины
 * поверх них.
 *
 * Бюджет — не вежливость, а сохранение сигнала: уведомление работает, пока
 * его читают, и приложение, пишущее каждый день, обучает смахивать себя не
 * глядя. Тогда и важное сообщение не будет прочитано.
 *
 * За один прогон уходит не больше одного уведомления на категорию и только
 * то, на что хватило недельного бюджета (`services/push/budget.ts`).
 */

const WEEK_MS = 7 * 86_400_000;
/** Прочность, ниже которой узел считается просевшим настолько, чтобы позвать. */
const WEAK_STRENGTH = 40;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 });
    }
    console.warn('CRON_SECRET не задан: эндпоинт открыт. В production это ответ 500.');
  } else {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const now = new Date();

  // Условие по вложенному jsonb-полю (`preferences.reviewRemindersEnabled`)
  // типобезопасно через Drizzle не выразить — фильтруем в памяти:
  // пользователей на личной установке единицы, это не проблема.
  const owners = (await db.query.users.findMany()).filter(
    (user) => withPreferenceDefaults(user.preferences).reviewRemindersEnabled,
  );

  const results: {
    userId: string;
    categories: PushCategory[];
    sent: number;
    expiredRemoved: number;
  }[] = [];

  for (const owner of owners) {
    const candidates = await collectCandidates(owner.id, now);
    if (candidates.length === 0) {
      results.push({ userId: owner.id, categories: [], sent: 0, expiredRemoved: 0 });
      continue;
    }

    const history = await db
      .select({ category: pushLog.category, at: pushLog.sentAt })
      .from(pushLog)
      .where(
        and(
          eq(pushLog.userId, owner.id),
          eq(pushLog.delivered, true),
          gte(pushLog.sentAt, new Date(now.getTime() - WEEK_MS)),
        ),
      );

    const selected = selectSendable(candidates, history, now);
    if (selected.length === 0) {
      results.push({ userId: owner.id, categories: [], sent: 0, expiredRemoved: 0 });
      continue;
    }

    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, owner.id));

    let sent = 0;
    let expiredRemoved = 0;
    const delivered: PushCategory[] = [];

    for (const candidate of selected) {
      let deliveredThis = false;

      for (const sub of subscriptions) {
        const result = await sendPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          candidate.payload,
        ).catch((error: unknown) => {
          logError(error, 'cron:send-reminders', { userId: owner.id });
          return { ok: false as const, expired: false, error: String(error) };
        });

        if (result.ok) {
          sent += 1;
          deliveredThis = true;
        } else if (result.expired) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          expiredRemoved += 1;
        }
      }

      // Бюджет тратит только доставленное: недоставленное уведомление человек
      // не видел, и списывать его с недельного лимита значит наказывать за
      // чужой сбой.
      if (deliveredThis) {
        delivered.push(candidate.category);
        await db.insert(pushLog).values({
          userId: owner.id,
          category: candidate.category,
          delivered: true,
        });
      }
    }

    results.push({ userId: owner.id, categories: delivered, sent, expiredRemoved });
  }

  return NextResponse.json({ checked: results.length, results });
}

/**
 * Что вообще можно было бы отправить. Бюджет применяется после — сначала
 * состояние данных, потом ограничения.
 */
async function collectCandidates(
  userId: string,
  now: Date,
): Promise<Candidate<ReminderPayload>[]> {
  const [dueCards, weakNodes, readyExperiments, dueCapsules] = await Promise.all([
    db
      .select({ id: fsrsCards.id })
      .from(fsrsCards)
      .where(
        and(
          eq(fsrsCards.userId, userId),
          lte(fsrsCards.due, now),
          isNull(fsrsCards.suspendedUntil),
        ),
      ),

    db
      .select({ title: knowledgeNodes.title, strength: nodeProgress.knowledgeStrength })
      .from(nodeProgress)
      .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, nodeProgress.nodeId))
      .where(
        and(
          eq(nodeProgress.userId, userId),
          lte(nodeProgress.knowledgeStrength, WEAK_STRENGTH),
          // Узел, к которому ещё не приступали, не «просел» — он не начат.
          gte(nodeProgress.totalReps, 5),
        ),
      )
      .orderBy(asc(nodeProgress.knowledgeStrength))
      .limit(1),

    db
      .select({ hypothesis: learningExperiments.hypothesis })
      .from(learningExperiments)
      .where(
        and(
          eq(learningExperiments.userId, userId),
          eq(learningExperiments.status, 'running'),
          isNotNull(learningExperiments.startedAt),
          // Окно эксперимента прошло — данных достаточно, чтобы смотреть.
          lte(learningExperiments.startedAt, new Date(now.getTime() - WEEK_MS)),
        ),
      )
      .limit(1),

    db
      .select({ title: notes.title })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          eq(notes.isArchived, false),
          isNotNull(notes.capsule),
          isNotNull(notes.resurfaceAt),
          lte(notes.resurfaceAt, now),
        ),
      )
      .orderBy(asc(notes.resurfaceAt))
      .limit(1),
  ]);

  const candidates: Candidate<ReminderPayload>[] = [];

  if (dueCards.length > 0) {
    candidates.push({ category: 'review_due', payload: reviewDueMessage(dueCards.length) });
  }
  const weak = weakNodes[0];
  if (weak) {
    candidates.push({
      category: 'node_weak',
      payload: nodeWeakMessage(weak.title, weak.strength),
    });
  }
  const experiment = readyExperiments[0];
  if (experiment) {
    candidates.push({
      category: 'experiment_ready',
      payload: experimentReadyMessage(experiment.hypothesis),
    });
  }
  const capsule = dueCapsules[0];
  if (capsule) {
    candidates.push({
      category: 'note_capsule',
      payload: capsuleMessage(capsule.title ?? 'Без названия'),
    });
  }

  return candidates;
}
