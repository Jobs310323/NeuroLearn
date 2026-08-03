import { z } from 'zod';

/** Валидация входа для путей и узлов. Общая для Server Actions и Route Handlers. */

export const createLearningPathSchema = z.object({
  title: z.string().trim().min(3, 'Минимум 3 символа').max(120),
  goal: z
    .string()
    .trim()
    .min(10, 'Опишите цель подробнее — от 10 символов')
    .max(2000),
  targetLevel: z.string().trim().max(200).optional(),
  description: z.string().trim().max(4000).optional(),
});
export type CreateLearningPathInput = z.infer<typeof createLearningPathSchema>;

export const updateLearningPathSchema = z.object({
  pathId: z.uuid(),
  title: z.string().trim().min(3).max(120).optional(),
  goal: z.string().trim().min(10).max(2000).optional(),
  description: z.string().trim().max(4000).nullish(),
  targetLevel: z.string().trim().max(200).nullish(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'archived']).optional(),
});

export const createNodeSchema = z.object({
  pathId: z.uuid(),
  parentId: z.uuid().nullish(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  weight: z.number().min(0).max(1).optional(),
  difficulty: z.number().min(0).max(1).optional(),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type CreateNodeInput = z.infer<typeof createNodeSchema>;

export const updateNodeSchema = z.object({
  nodeId: z.uuid(),
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  weight: z.number().min(0).max(1).optional(),
  difficulty: z.number().min(0).max(1).optional(),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
  parentId: z.uuid().nullish(),
});

export const moveNodesSchema = z.object({
  pathId: z.uuid(),
  positions: z
    .array(z.object({ nodeId: z.uuid(), x: z.number(), y: z.number() }))
    .min(1)
    .max(500),
});

export const deleteNodeSchema = z.object({
  nodeId: z.uuid(),
  /** false — детей поднять к родителю удаляемого узла, true — удалить поддерево. */
  cascade: z.boolean().default(false),
});

export const upsertEdgeSchema = z.object({
  sourceId: z.uuid(),
  targetId: z.uuid(),
  relation: z.enum(['prerequisite', 'related', 'contrast', 'analogous']),
  strength: z.number().min(0).max(1).optional(),
});

export const deleteEdgeSchema = z.object({
  sourceId: z.uuid(),
  targetId: z.uuid(),
  relation: z.enum(['prerequisite', 'related', 'contrast', 'analogous']),
});
