import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { notes } from '@/lib/db/schema';
import { normalizeConfidence } from '@/lib/services/learner/calibration';

/**
 * Капсула времени: назначение даты и ответ «сбылось ли».
 *
 * Ответ — не эмоция и не отметка о прочтении, а точка данных калибровки того
 * же рода, что пара (уверенность, правильность) в практике. Человек записал
 * предсказание с уверенностью 4 из 5; через месяц выяснилось, что не сбылось.
 * Это ровно то же переоценивание себя, только на горизонте месяца, а не
 * одного задания.
 *
 * AI здесь не участвует. Оценивать, «сбылось ли», может только автор
 * предсказания: модель не знает его контекста и превратила бы данные о
 * калибровке в собственную догадку.
 */

const paramsSchema = z.object({ noteId: z.uuid() });

const scheduleSchema = z.object({
  kind: z.literal('schedule'),
  prediction: z.string().trim().min(1).max(2000),
  confidence: z.number().int().min(1).max(5),
  resurfaceAt: z.iso.datetime(),
});

const answerSchema = z.object({
  kind: z.literal('answer'),
  outcome: z.enum(['happened', 'partly', 'not_happened']),
  outcomeNote: z.string().trim().max(2000).nullish(),
});

const bodySchema = z.discriminatedUnion('kind', [scheduleSchema, answerSchema]);

/** Насколько предсказание сбылось, в той же шкале 0..1, что и точность. */
const OUTCOME_SCORE: Record<'happened' | 'partly' | 'not_happened', number> = {
  happened: 1,
  partly: 0.5,
  not_happened: 0,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const id = paramsSchema.safeParse(await params);
  if (!id.success) return apiError('NOT_FOUND', 'Заметка не найдена.');

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, id.data.noteId), eq(notes.userId, userId)),
  });
  if (!note) return apiError('NOT_FOUND', 'Заметка не найдена.');

  if (parsed.data.kind === 'schedule') {
    const at = new Date(parsed.data.resurfaceAt);
    if (at.getTime() <= Date.now()) {
      return apiError('VALIDATION_FAILED', 'Дата капсулы должна быть в будущем.');
    }

    await db
      .update(notes)
      .set({
        capsule: {
          prediction: parsed.data.prediction,
          confidence: parsed.data.confidence,
          outcome: null,
          outcomeNote: null,
          answeredAt: null,
        },
        resurfaceAt: at,
        resurfaceReason: 'капсула времени',
        version: note.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(notes.id, note.id));

    return NextResponse.json({ scheduled: true, resurfaceAt: at.toISOString() });
  }

  if (!note.capsule) {
    return apiError('VALIDATION_FAILED', 'У этой заметки нет капсулы времени.');
  }
  if (note.capsule.answeredAt) {
    return apiError('CONFLICT', 'На капсулу уже отвечали.');
  }

  const answeredAt = new Date();
  await db
    .update(notes)
    .set({
      capsule: {
        ...note.capsule,
        outcome: parsed.data.outcome,
        outcomeNote: parsed.data.outcomeNote ?? null,
        answeredAt: answeredAt.toISOString(),
      },
      // Дата возврата снимается: капсула отработала. Дальше заметкой
      // распоряжается обычный планировщик живых заметок.
      resurfaceAt: null,
      resurfaceReason: null,
      version: note.version + 1,
      updatedAt: answeredAt,
    })
    .where(eq(notes.id, note.id));

  const predicted = normalizeConfidence(note.capsule.confidence);
  const actual = OUTCOME_SCORE[parsed.data.outcome];

  return NextResponse.json({
    answered: true,
    calibration: {
      predictedConfidence: predicted,
      outcomeScore: actual,
      /** >0 — переоценка себя, как и везде в приложении. */
      gap: predicted - actual,
    },
  });
}
