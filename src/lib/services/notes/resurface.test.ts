import { describe, expect, it } from 'vitest';

import {
  MAX_NOTES_BEFORE_SESSION,
  pickNotesForSession,
  scheduleNote,
  scheduleNotes,
  type NodeReviewState,
  type NoteScheduleInput,
} from './resurface';

const NOW = new Date('2026-06-01T12:00:00Z');
const DAY = 86_400_000;

function note(overrides: Partial<NoteScheduleInput> = {}): NoteScheduleInput {
  return {
    noteId: 'note-1',
    resurfaceAt: null,
    isCapsule: false,
    nodeId: 'n1',
    isArchived: false,
    updatedAt: new Date(NOW.getTime() - 10 * DAY),
    ...overrides,
  };
}

function node(overrides: Partial<NodeReviewState> = {}): NodeReviewState {
  return { nodeId: 'n1', due: null, status: 'in_progress', ...overrides };
}

describe('scheduleNote', () => {
  it('поднимает заметку за 12 часов до повторения узла', () => {
    const due = new Date(NOW.getTime() + 3 * DAY);
    const decision = scheduleNote(note(), node({ due }), NOW);

    expect(decision.resurfaceAt?.getTime()).toBe(due.getTime() - 12 * 3_600_000);
    expect(decision.reason).toBe('скоро повторение узла');
  });

  it('пробел в узле поднимает заметку немедленно, не дожидаясь расписания', () => {
    const decision = scheduleNote(
      note(),
      node({ status: 'has_gaps', due: new Date(NOW.getTime() + 30 * DAY) }),
      NOW,
    );
    expect(decision.resurfaceAt).toEqual(NOW);
    expect(decision.reason).toBe('по узлу есть пробелы');
  });

  it('статус needs_review тоже поднимает немедленно', () => {
    expect(scheduleNote(note(), node({ status: 'needs_review' }), NOW).resurfaceAt).toEqual(NOW);
  });

  it('капсула времени сильнее планировщика — дату назначил человек', () => {
    const capsuleDate = new Date('2027-01-01T00:00:00Z');
    const decision = scheduleNote(
      note({ isCapsule: true, resurfaceAt: capsuleDate }),
      node({ status: 'has_gaps' }),
      NOW,
    );
    expect(decision.resurfaceAt).toEqual(capsuleDate);
  });

  it('заметка, написанная час назад, не возвращается', () => {
    const decision = scheduleNote(
      note({ updatedAt: new Date(NOW.getTime() - 3_600_000) }),
      node({ status: 'has_gaps' }),
      NOW,
    );
    expect(decision.resurfaceAt).toBeNull();
  });

  it('без якоря на узел возвращать заметку не к чему', () => {
    expect(scheduleNote(note({ nodeId: null }), null, NOW).resurfaceAt).toBeNull();
  });

  it('архивная заметка не возвращается', () => {
    expect(
      scheduleNote(note({ isArchived: true }), node({ status: 'has_gaps' }), NOW).resurfaceAt,
    ).toBeNull();
  });

  it('без карточки FSRS и без тревожного статуса даты нет', () => {
    expect(scheduleNote(note(), node({ due: null, status: 'mastered' }), NOW).resurfaceAt).toBeNull();
  });

  it('давно прошедшее повторение при спокойном статусе заметку не поднимает', () => {
    const decision = scheduleNote(
      note(),
      node({ due: new Date(NOW.getTime() - 10 * DAY), status: 'mastered' }),
      NOW,
    );
    expect(decision.resurfaceAt).toBeNull();
  });

  it('детерминированность: два одинаковых вызова совпадают', () => {
    const input = note();
    const state = node({ due: new Date(NOW.getTime() + 2 * DAY) });
    expect(scheduleNote(input, state, NOW)).toEqual(scheduleNote(input, state, NOW));
  });
});

describe('scheduleNotes', () => {
  it('возвращает только изменившиеся решения', () => {
    const due = new Date(NOW.getTime() + 3 * DAY);
    const expected = new Date(due.getTime() - 12 * 3_600_000);

    const decisions = scheduleNotes(
      [
        // Дата уже совпадает — писать нечего.
        note({ noteId: 'unchanged', resurfaceAt: expected }),
        // Даты не было — появилась.
        note({ noteId: 'changed', resurfaceAt: null }),
      ],
      [node({ due })],
      NOW,
    );

    expect(decisions.map((d) => d.noteId)).toEqual(['changed']);
  });

  it('снятие даты тоже считается изменением', () => {
    const decisions = scheduleNotes(
      [note({ noteId: 'stale', resurfaceAt: new Date(NOW.getTime() + DAY) })],
      [node({ due: null, status: 'mastered' })],
      NOW,
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.resurfaceAt).toBeNull();
  });

  it('пустой вход — пустой выход', () => {
    expect(scheduleNotes([], [], NOW)).toEqual([]);
  });
});

describe('pickNotesForSession', () => {
  it('берёт не больше двух заметок', () => {
    const due = Array.from({ length: 5 }, (_, i) => ({
      resurfaceAt: new Date(NOW.getTime() - (i + 1) * DAY),
      confusionFlag: false,
      id: `n${i}`,
    }));
    expect(pickNotesForSession(due, NOW)).toHaveLength(MAX_NOTES_BEFORE_SESSION);
  });

  it('заметки с флагом непонимания идут первыми', () => {
    const picked = pickNotesForSession(
      [
        { id: 'old', resurfaceAt: new Date(NOW.getTime() - 10 * DAY), confusionFlag: false },
        { id: 'confused', resurfaceAt: new Date(NOW.getTime() - DAY), confusionFlag: true },
      ],
      NOW,
    );
    expect(picked[0]!.id).toBe('confused');
  });

  it('среди равных — самые просроченные', () => {
    const picked = pickNotesForSession(
      [
        { id: 'recent', resurfaceAt: new Date(NOW.getTime() - DAY), confusionFlag: false },
        { id: 'old', resurfaceAt: new Date(NOW.getTime() - 5 * DAY), confusionFlag: false },
      ],
      NOW,
    );
    expect(picked[0]!.id).toBe('old');
  });

  it('заметки с датой в будущем не берутся', () => {
    expect(
      pickNotesForSession(
        [{ id: 'future', resurfaceAt: new Date(NOW.getTime() + DAY), confusionFlag: false }],
        NOW,
      ),
    ).toEqual([]);
  });
});
