import { and, desc, eq } from 'drizzle-orm';
import { createEmptyCard, fsrs, generatorParameters, type Grade } from 'ts-fsrs';

import { db } from '@/lib/db';
import { fsrsCards, reviewLogs, users, type FsrsCard } from '@/lib/db/schema';
import { DEFAULT_USER_PREFERENCES } from '@/lib/db/schema/types';

import { cardToRowUpdate, ratingFromDb, rowToCard, stateFromDb, type DbFsrsRating } from './mapping';

/**
 * Планировщик FSRS. Единица планирования — узел знаний (PRD §10): карточка
 * заводится на узел целиком, а не на отдельное задание.
 */

function engineFor(requestRetention: number) {
  return fsrs(generatorParameters({ request_retention: requestRetention, enable_fuzz: true }));
}

async function requestRetentionFor(userId: string): Promise<number> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true },
  });
  return user?.preferences.requestRetention ?? DEFAULT_USER_PREFERENCES.requestRetention;
}

/** Возвращает карточку узла, создавая её в состоянии `new`, если это первое обращение. */
export async function ensureCard(userId: string, nodeId: string): Promise<FsrsCard> {
  const existing = await db.query.fsrsCards.findFirst({
    where: and(eq(fsrsCards.userId, userId), eq(fsrsCards.nodeId, nodeId)),
  });
  if (existing) return existing;

  const empty = createEmptyCard(new Date());
  const [created] = await db
    .insert(fsrsCards)
    .values({ userId, nodeId, ...cardToRowUpdate(empty) })
    .onConflictDoNothing({ target: [fsrsCards.userId, fsrsCards.nodeId] })
    .returning();

  if (created) return created;

  // Гонка: другой запрос успел создать карточку между SELECT и INSERT.
  const raced = await db.query.fsrsCards.findFirst({
    where: and(eq(fsrsCards.userId, userId), eq(fsrsCards.nodeId, nodeId)),
  });
  if (!raced) throw new Error('Не удалось создать FSRS-карточку.');
  return raced;
}

export type ReviewPreview = Record<DbFsrsRating, { due: Date; scheduledDays: number }>;

/** Что будет при каждой из четырёх оценок — для подписей на кнопках, без записи в БД. */
export async function previewReview(userId: string, card: FsrsCard): Promise<ReviewPreview> {
  const engine = engineFor(await requestRetentionFor(userId));
  const preview = engine.repeat(rowToCard(card), new Date());
  const result = {} as ReviewPreview;
  for (const item of preview) {
    result[item.log.rating === 1 ? 'again' : item.log.rating === 2 ? 'hard' : item.log.rating === 3 ? 'good' : 'easy'] = {
      due: item.card.due,
      scheduledDays: item.card.scheduled_days,
    };
  }
  return result;
}

/** Применяет оценку: планирует следующий показ и пишет запись в журнал. */
export async function applyReview(params: {
  userId: string;
  card: FsrsCard;
  rating: DbFsrsRating;
  now?: Date;
  sessionId?: string | null;
  derivedFrom?: 0 | 1;
}): Promise<{ card: FsrsCard; logId: string }> {
  const now = params.now ?? new Date();
  const engine = engineFor(await requestRetentionFor(params.userId));
  const grade: Grade = ratingFromDb(params.rating);
  const { card: nextCard, log } = engine.next(rowToCard(params.card), now, grade);

  const [updated] = await db
    .update(fsrsCards)
    .set(cardToRowUpdate(nextCard))
    .where(eq(fsrsCards.id, params.card.id))
    .returning();
  if (!updated) throw new Error('Карточка не найдена при записи оценки.');

  const [logRow] = await db
    .insert(reviewLogs)
    .values({
      cardId: params.card.id,
      userId: params.userId,
      sessionId: params.sessionId ?? null,
      rating: params.rating,
      state: params.card.state,
      due: log.due,
      stability: log.stability,
      difficulty: log.difficulty,
      elapsedDays: log.elapsed_days,
      lastElapsedDays: log.elapsed_days,
      scheduledDays: log.scheduled_days,
      learningSteps: log.learning_steps,
      reviewedAt: log.review,
      derivedFrom: params.derivedFrom ?? 0,
    })
    .returning({ id: reviewLogs.id });
  if (!logRow) throw new Error('Не удалось записать журнал повторения.');

  return { card: updated, logId: logRow.id };
}

/**
 * Оценка, выводимая из результатов сессии практики по узлу (PRD, `docs/API.md` §4):
 * точность и скорость -> `again`/`hard`/`good`/`easy`. Ручной выбор — переопределение.
 */
export function deriveRatingFromSession(params: {
  accuracy: number;
  meanResponseMs: number | null;
  targetResponseMs: number | null;
}): DbFsrsRating {
  if (params.accuracy < 0.5) return 'again';
  const fast =
    params.targetResponseMs != null &&
    params.meanResponseMs != null &&
    params.meanResponseMs <= params.targetResponseMs * 1.3;
  if (params.accuracy < 0.8) return 'hard';
  return fast ? 'easy' : 'good';
}

const ROLLBACK_WINDOW_MS = 5 * 60 * 1000;

/**
 * Отменяет последнее повторение карточки (`ts-fsrs.rollback`). Доступно
 * 5 минут после оценки (`docs/API.md` §4) — дальше отмена рискует зацепить
 * повторение, на которое уже опирается более поздний пересчёт прогресса.
 */
export async function rollbackLastReview(
  userId: string,
  cardId: string,
): Promise<{ card: FsrsCard } | { error: 'NOT_FOUND' | 'NO_HISTORY' | 'WINDOW_EXPIRED' }> {
  const card = await db.query.fsrsCards.findFirst({
    where: and(eq(fsrsCards.userId, userId), eq(fsrsCards.id, cardId)),
  });
  if (!card) return { error: 'NOT_FOUND' };

  const lastLog = await db.query.reviewLogs.findFirst({
    where: eq(reviewLogs.cardId, cardId),
    orderBy: [desc(reviewLogs.reviewedAt)],
  });
  if (!lastLog) return { error: 'NO_HISTORY' };
  if (Date.now() - lastLog.reviewedAt.getTime() > ROLLBACK_WINDOW_MS) return { error: 'WINDOW_EXPIRED' };

  const engine = fsrs(generatorParameters());
  const previous = engine.rollback(rowToCard(card), {
    rating: ratingFromDb(lastLog.rating),
    state: stateFromDb(lastLog.state),
    due: lastLog.due,
    stability: lastLog.stability,
    difficulty: lastLog.difficulty,
    elapsed_days: lastLog.elapsedDays,
    last_elapsed_days: lastLog.lastElapsedDays,
    scheduled_days: lastLog.scheduledDays,
    learning_steps: lastLog.learningSteps,
    review: lastLog.reviewedAt,
  });

  const [updated] = await db
    .update(fsrsCards)
    .set(cardToRowUpdate(previous))
    .where(eq(fsrsCards.id, cardId))
    .returning();
  if (!updated) throw new Error('Не удалось откатить карточку.');

  await db.delete(reviewLogs).where(eq(reviewLogs.id, lastLog.id));

  return { card: updated };
}
