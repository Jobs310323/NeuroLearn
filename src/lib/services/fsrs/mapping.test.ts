import { Rating, State, type Card } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';

import type { FsrsCard } from '@/lib/db/schema';

import {
  cardToRowUpdate,
  ratingFromDb,
  ratingToDb,
  rowToCard,
  stateFromDb,
  stateToDb,
  type DbFsrsRating,
  type DbFsrsState,
} from './mapping';

/**
 * Мост БД <-> ts-fsrs. Ошибка здесь не падает, а тихо сдвигает расписание
 * повторений (например, `relearning` вместо `review`), поэтому проверяется
 * биективность обоих отображений на всех значениях, а не пара примеров.
 */

const DB_STATES: DbFsrsState[] = ['new', 'learning', 'review', 'relearning'];
const DB_RATINGS: DbFsrsRating[] = ['again', 'hard', 'good', 'easy'];
const LIB_STATES = [State.New, State.Learning, State.Review, State.Relearning];
const LIB_RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

describe('состояния', () => {
  it.each(DB_STATES)('%s переживает roundtrip из БД', (state) => {
    expect(stateToDb(stateFromDb(state))).toBe(state);
  });

  it.each(LIB_STATES)('State %s переживает roundtrip из ts-fsrs', (state) => {
    expect(stateFromDb(stateToDb(state))).toBe(state);
  });

  it('различает все четыре состояния', () => {
    expect(new Set(DB_STATES.map(stateFromDb)).size).toBe(DB_STATES.length);
  });
});

describe('оценки', () => {
  it.each(DB_RATINGS)('%s переживает roundtrip из БД', (rating) => {
    expect(ratingToDb(ratingFromDb(rating))).toBe(rating);
  });

  it.each(LIB_RATINGS)('Rating %s переживает roundtrip из ts-fsrs', (rating) => {
    expect(ratingFromDb(ratingToDb(rating))).toBe(rating);
  });

  it('различает все четыре оценки', () => {
    expect(new Set(DB_RATINGS.map(ratingFromDb)).size).toBe(DB_RATINGS.length);
  });
});

const due = new Date('2026-08-20T10:00:00.000Z');
const lastReview = new Date('2026-08-13T10:00:00.000Z');

const row = {
  id: 'card-1',
  userId: 'user-1',
  nodeId: 'node-1',
  due,
  stability: 12.5,
  difficulty: 5.25,
  elapsedDays: 7,
  scheduledDays: 10,
  learningSteps: 2,
  reps: 4,
  lapses: 1,
  state: 'review',
  lastReview,
} as unknown as FsrsCard;

describe('rowToCard / cardToRowUpdate', () => {
  it('переносит поля со сменой конвенции имён', () => {
    const card = rowToCard(row);
    expect(card).toMatchObject({
      due,
      stability: 12.5,
      difficulty: 5.25,
      elapsed_days: 7,
      scheduled_days: 10,
      learning_steps: 2,
      reps: 4,
      lapses: 1,
      state: State.Review,
      last_review: lastReview,
    });
  });

  it('roundtrip строка -> Card -> обновление строки не теряет значений', () => {
    const update = cardToRowUpdate(rowToCard(row));
    expect(update).toMatchObject({
      due,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsedDays: row.elapsedDays,
      scheduledDays: row.scheduledDays,
      learningSteps: row.learningSteps,
      reps: row.reps,
      lapses: row.lapses,
      state: 'review',
      lastReview,
    });
  });

  it('новая карточка без последнего повторения: null в БД, undefined в ts-fsrs', () => {
    const fresh = { ...row, state: 'new', lastReview: null } as unknown as FsrsCard;
    expect(rowToCard(fresh).last_review).toBeUndefined();
    expect(cardToRowUpdate(rowToCard(fresh)).lastReview).toBeNull();
  });

  it('проставляет updatedAt при записи', () => {
    expect(cardToRowUpdate(rowToCard(row)).updatedAt).toBeInstanceOf(Date);
  });

  it('принимает Card, собранный вручную', () => {
    const card: Card = {
      due,
      stability: 1,
      difficulty: 2,
      elapsed_days: 0,
      scheduled_days: 1,
      learning_steps: 0,
      reps: 1,
      lapses: 0,
      state: State.Learning,
      last_review: undefined,
    };
    expect(cardToRowUpdate(card).state).toBe('learning');
  });
});
