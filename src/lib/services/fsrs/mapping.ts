import { Rating, State, type Card, type Grade } from 'ts-fsrs';

import type { FsrsCard } from '@/lib/db/schema';
import type { fsrsRatingEnum, fsrsStateEnum } from '@/lib/db/schema/enums';

/**
 * Мост между БД (`fsrs_state`/`fsrs_rating` — читаемые enum) и числовыми
 * `State`/`Rating` из `ts-fsrs`. Разделено намеренно: в БД должно быть
 * читаемо без библиотеки под рукой, в вычислениях — то, что ждёт `ts-fsrs`.
 */

export type DbFsrsState = (typeof fsrsStateEnum.enumValues)[number];
export type DbFsrsRating = (typeof fsrsRatingEnum.enumValues)[number];

const STATE_TO_ENUM: Record<State, DbFsrsState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const ENUM_TO_STATE: Record<DbFsrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const RATING_TO_ENUM: Record<Grade, DbFsrsRating> = {
  [Rating.Again]: 'again',
  [Rating.Hard]: 'hard',
  [Rating.Good]: 'good',
  [Rating.Easy]: 'easy',
};

const ENUM_TO_RATING: Record<DbFsrsRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function stateToDb(state: State): DbFsrsState {
  return STATE_TO_ENUM[state];
}

export function stateFromDb(state: DbFsrsState): State {
  return ENUM_TO_STATE[state];
}

export function ratingToDb(rating: Grade): DbFsrsRating {
  return RATING_TO_ENUM[rating];
}

export function ratingFromDb(rating: DbFsrsRating): Grade {
  return ENUM_TO_RATING[rating];
}

/** Строка `fsrs_cards` -> `Card` из `ts-fsrs`. */
export function rowToCard(row: FsrsCard): Card {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: stateFromDb(row.state),
    last_review: row.lastReview ?? undefined,
  };
}

/** `Card` из `ts-fsrs` -> поля для записи в `fsrs_cards`. */
export function cardToRowUpdate(card: Card) {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: stateToDb(card.state),
    lastReview: card.last_review ?? null,
    updatedAt: new Date(),
  };
}
