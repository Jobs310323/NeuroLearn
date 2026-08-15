import { z } from 'zod';

/** Валидация загрузки источников. Файл и текст не в Zod — идут через FormData. */

export const uploadSourceMetaSchema = z.object({
  title: z.string().trim().min(2, 'Минимум 2 символа').max(200),
  pathId: z.uuid().nullish(),
});

export const deleteSourceSchema = z.object({
  documentId: z.uuid(),
});

export const attachSourceSchema = z.object({
  documentId: z.uuid(),
  pathId: z.uuid().nullable(),
});
