import { z } from 'zod';

/** Валидация контракта дневника рефлексии — `docs/API.md` §6. */

export const reflectionTypeSchema = z.enum([
  'pre_flight',
  'post_module',
  'error_analysis',
  'weekly',
  'project_defense',
]);

export type ReflectionType = z.infer<typeof reflectionTypeSchema>;

export const reflectionPromptsQuerySchema = z.object({
  nodeId: z.uuid(),
  type: reflectionTypeSchema.optional().default('post_module'),
});

const selfAssessmentSchema = z.object({
  perceivedMastery: z.number().int().min(1).max(5),
  hardestPart: z.string().max(500),
  plannedNextStep: z.string().max(500),
  checklist: z.array(
    z.object({ id: z.string(), label: z.string(), checked: z.boolean() }),
  ),
});

export const createReflectionSchema = z
  .object({
    type: reflectionTypeSchema,
    nodeId: z.uuid().optional(),
    pathId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
    body: z.string().min(1),
    prompts: z.array(z.string()).optional().default([]),
    selfAssessment: selfAssessmentSchema.optional(),
  })
  .refine((v) => v.nodeId || v.pathId, {
    message: 'Нужен nodeId или pathId.',
  });
