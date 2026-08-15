import { z } from 'zod';

/** Валидация сдачи проекта — `docs/API.md` §7. */

export const submitProjectSchema = z
  .object({
    projectId: z.uuid(),
    artifactUrl: z.string().trim().url('Некорректная ссылка').max(2000).optional(),
    content: z.string().trim().max(20000).optional(),
  })
  .refine((v) => Boolean(v.artifactUrl || v.content), {
    message: 'Укажите ссылку на артефакт или текст решения.',
  });
export type SubmitProjectInput = z.infer<typeof submitProjectSchema>;
