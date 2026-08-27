import { z } from 'zod';

/**
 * Валидация тетради. Общая для Route Handlers и офлайн-очереди: очередь
 * отправляет ровно то же тело, что и онлайновый клиент, поэтому схема должна
 * быть одна — иначе накопленная офлайн заметка отвергается сервером уже
 * после того, как человек считал её сохранённой.
 */

export const NOTE_TYPES = [
  'capture',
  'summary',
  'idea',
  'reflection',
  'question',
  'quote',
  'link_note',
] as const;

export const NOTE_RELATIONS = [
  'supports',
  'contradicts',
  'extends',
  'question_of',
  'example_of',
] as const;

export const NOTE_COLORS = [
  'neutral',
  'insight',
  'question',
  'gap',
  'source',
  'contradiction',
] as const;

/** 64 КБ на заметку: длиннее — это уже не заметка, а источник. */
const CONTENT_MAX = 64_000;

export const noteSourceAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pages'), from: z.number().int().min(1), to: z.number().int().min(1) }),
  z.object({
    kind: z.literal('time'),
    fromSec: z.number().min(0),
    toSec: z.number().min(0),
  }),
  z.object({ kind: z.literal('chunk'), chunkIds: z.array(z.uuid()).min(1).max(50) }),
  z.object({ kind: z.literal('quote'), text: z.string().trim().min(1).max(4000) }),
]);

export const noteCapsuleSchema = z.object({
  prediction: z.string().trim().min(1).max(2000),
  confidence: z.number().int().min(1).max(5),
  outcome: z.enum(['happened', 'partly', 'not_happened']).nullable().default(null),
  outcomeNote: z.string().trim().max(2000).nullable().default(null),
  answeredAt: z.iso.datetime().nullable().default(null),
});

const anchors = {
  nodeId: z.uuid().nullish(),
  sessionId: z.uuid().nullish(),
  assessmentId: z.uuid().nullish(),
  experimentId: z.uuid().nullish(),
  sourceId: z.uuid().nullish(),
  sourceAnchor: noteSourceAnchorSchema.nullish(),
  parentNoteId: z.uuid().nullish(),
};

export const createNoteSchema = z.object({
  /**
   * Идентификатор задаёт клиент. Так офлайн-очередь может повторить отправку
   * без риска создать дубль: повтор попадает в тот же первичный ключ.
   */
  id: z.uuid().optional(),
  type: z.enum(NOTE_TYPES).default('capture'),
  title: z.string().trim().max(200).nullish(),
  contentMd: z.string().max(CONTENT_MAX).default(''),
  colorLabel: z.enum(NOTE_COLORS).default('neutral'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  ...anchors,
  resurfaceAt: z.iso.datetime().nullish(),
  resurfaceReason: z.string().trim().max(300).nullish(),
  capsule: noteCapsuleSchema.nullish(),
  confusionFlag: z.boolean().default(false),
  pinned: z.boolean().default(false),
  /** Заполнено — сохраняем как конфликтную копию рядом с оригиналом. */
  conflictOfNoteId: z.uuid().nullish(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z.object({
  /**
   * Версия, от которой человек правил. Обязательна: без неё запись всегда
   * «последний выиграл», и параллельная правка с другого устройства пропадает
   * молча — ровно то, что инвариант конкурентной записи запрещает.
   */
  version: z.number().int().min(1),
  type: z.enum(NOTE_TYPES).optional(),
  title: z.string().trim().max(200).nullish(),
  contentMd: z.string().max(CONTENT_MAX).optional(),
  colorLabel: z.enum(NOTE_COLORS).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  ...anchors,
  resurfaceAt: z.iso.datetime().nullish(),
  resurfaceReason: z.string().trim().max(300).nullish(),
  capsule: noteCapsuleSchema.nullish(),
  confusionFlag: z.boolean().optional(),
  pinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

export const listNotesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: z.enum(NOTE_TYPES).optional(),
  color: z.enum(NOTE_COLORS).optional(),
  tag: z.string().trim().max(40).optional(),
  nodeId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
  sourceId: z.uuid().optional(),
  experimentId: z.uuid().optional(),
  /** Только помеченные «не понял» — реестр непонимания. */
  confusion: z.coerce.boolean().optional(),
  pinned: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().default(false),
  /** Заметки, которым пора вернуться (капсулы и живые заметки). */
  due: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;

export const upsertNoteLinkSchema = z.object({
  toNoteId: z.uuid(),
  relation: z.enum(NOTE_RELATIONS),
});

export const deleteNoteLinkSchema = upsertNoteLinkSchema;
