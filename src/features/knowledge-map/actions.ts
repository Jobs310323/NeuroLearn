'use server';

import { and, eq, inArray, max, sql as raw } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUserId } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { knowledgeNodes, learningPaths, nodeEdges, nodeProgress } from '@/lib/db/schema';
import { wouldCreateCycle } from '@/lib/services/graph/acyclic';
import { slugify } from '@/lib/utils';
import {
  arrangeNodesSchema,
  createNodeSchema,
  deleteEdgeSchema,
  deleteNodeSchema,
  moveNodesSchema,
  updateNodeSchema,
  upsertEdgeSchema,
} from '@/lib/validation/learning';

import type { ActionResult } from '../learning-path/actions';

/** Проверка владения путём. Единственный вход для авторизации узлов. */
async function assertPathOwner(userId: string, pathId: string): Promise<boolean> {
  const path = await db.query.learningPaths.findFirst({
    where: and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)),
    columns: { id: true },
  });
  return Boolean(path);
}

async function pathIdOfNode(userId: string, nodeId: string): Promise<string | null> {
  const row = await db
    .select({ pathId: knowledgeNodes.pathId, userId: learningPaths.userId })
    .from(knowledgeNodes)
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(eq(knowledgeNodes.id, nodeId))
    .limit(1);

  const found = row[0];
  if (!found || found.userId !== userId) return null;
  return found.pathId;
}

/** Уникальный в пределах пути слаг: `basis`, `basis-2`, `basis-3`… */
async function uniqueSlug(pathId: string, title: string): Promise<string> {
  const base = slugify(title);
  const taken = await db
    .select({ slug: knowledgeNodes.slug })
    .from(knowledgeNodes)
    .where(and(eq(knowledgeNodes.pathId, pathId), raw`${knowledgeNodes.slug} LIKE ${base + '%'}`));

  const used = new Set(taken.map((t) => t.slug));
  if (!used.has(base)) return base;

  for (let i = 2; i < 500; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function createNode(input: unknown): Promise<ActionResult<{ nodeId: string }>> {
  const userId = await requireUserId();
  const parsed = createNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const { pathId, parentId, title, description, weight, difficulty, estimatedMinutes, position } =
    parsed.data;

  if (!(await assertPathOwner(userId, pathId))) {
    return { ok: false, error: 'Путь не найден' };
  }

  let depth = 0;
  if (parentId) {
    const parent = await db.query.knowledgeNodes.findFirst({
      where: and(eq(knowledgeNodes.id, parentId), eq(knowledgeNodes.pathId, pathId)),
      columns: { depth: true },
    });
    if (!parent) return { ok: false, error: 'Родительский узел не найден' };
    depth = parent.depth + 1;
  }

  const [{ value: maxOrder } = { value: null }] = await db
    .select({ value: max(knowledgeNodes.orderIndex) })
    .from(knowledgeNodes)
    .where(
      and(
        eq(knowledgeNodes.pathId, pathId),
        parentId
          ? eq(knowledgeNodes.parentId, parentId)
          : raw`${knowledgeNodes.parentId} IS NULL`,
      ),
    );

  const slug = await uniqueSlug(pathId, title);

  const [created] = await db
    .insert(knowledgeNodes)
    .values({
      pathId,
      parentId: parentId ?? null,
      slug,
      title,
      description: description ?? null,
      depth,
      orderIndex: (maxOrder ?? -1) + 1,
      weight: weight ?? 0.5,
      difficulty: difficulty ?? 0.5,
      estimatedMinutes: estimatedMinutes ?? 20,
      posX: position?.x ?? 0,
      posY: position?.y ?? depth * 160,
    })
    .returning({ id: knowledgeNodes.id });

  if (!created) return { ok: false, error: 'Не удалось создать узел' };

  // Строка прогресса создаётся сразу — так все чтения обходятся без LEFT JOIN-ветвлений.
  await db.insert(nodeProgress).values({ nodeId: created.id, userId });

  revalidatePath(`/paths/${pathId}`);
  return { ok: true, data: { nodeId: created.id } };
}

export async function updateNode(input: unknown): Promise<ActionResult<null>> {
  const userId = await requireUserId();
  const parsed = updateNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const { nodeId, ...fields } = parsed.data;
  const pathId = await pathIdOfNode(userId, nodeId);
  if (!pathId) return { ok: false, error: 'Узел не найден' };

  if (fields.parentId === nodeId) {
    return { ok: false, error: 'Узел не может быть родителем самому себе' };
  }

  await db
    .update(knowledgeNodes)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(knowledgeNodes.id, nodeId));

  revalidatePath(`/paths/${pathId}`);
  return { ok: true, data: null };
}

/**
 * Запись координат узлов пути с оптимистической блокировкой по
 * `learning_paths.layout_version`.
 *
 * Общая для ручного перетаскивания и для кнопки «Упорядочить»: и то, и другое
 * меняет одну и ту же вещь — раскладку карты, — и конфликтовать они обязаны
 * по одному правилу. Версия сравнивается прямо в `WHERE` инкремента: между
 * чтением и записью может пройти чужая правка, а интерактивных транзакций у
 * драйвера neon-http нет.
 */
async function writePositions(
  userId: string,
  pathId: string,
  positions: { nodeId: string; x: number; y: number }[],
  expectedLayoutVersion: number | undefined,
  grouping?: string,
): Promise<ActionResult<{ layoutVersion: number }>> {
  const path = await db.query.learningPaths.findFirst({
    where: and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)),
    columns: { id: true, layoutVersion: true },
  });
  if (!path) return { ok: false, error: 'Путь не найден' };

  if (expectedLayoutVersion !== undefined && expectedLayoutVersion !== path.layoutVersion) {
    return {
      ok: false,
      error:
        'Раскладку изменили в другом месте. Обновите карту — иначе чужая расстановка пропадёт молча.',
      conflict: { serverLayoutVersion: path.layoutVersion },
    };
  }

  const owned = await db
    .select({ id: knowledgeNodes.id })
    .from(knowledgeNodes)
    .where(
      and(
        eq(knowledgeNodes.pathId, pathId),
        inArray(
          knowledgeNodes.id,
          positions.map((p) => p.nodeId),
        ),
      ),
    );
  const ownedIds = new Set(owned.map((o) => o.id));
  const allowed = positions.filter((p) => ownedIds.has(p.nodeId));
  if (allowed.length === 0) return { ok: false, error: 'Узлы не найдены' };

  const bump = db
    .update(learningPaths)
    .set({
      layoutVersion: path.layoutVersion + 1,
      ...(grouping ? { layoutGrouping: grouping } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(learningPaths.id, pathId),
        eq(learningPaths.userId, userId),
        eq(learningPaths.layoutVersion, path.layoutVersion),
      ),
    )
    .returning({ layoutVersion: learningPaths.layoutVersion });

  const updates = allowed.map((p) =>
    db
      .update(knowledgeNodes)
      .set({ posX: p.x, posY: p.y })
      .where(eq(knowledgeNodes.id, p.nodeId)),
  );

  // Драйвер neon-http не даёт интерактивных транзакций — пишем одним batch.
  // Инкремент версии идёт первым: если он не прошёл (чужая запись успела
  // раньше), координаты в том же batch уже не применятся.
  const [bumped] = await db.batch([bump, ...updates] as [
    typeof bump,
    ...typeof updates,
  ]);

  const nextVersion = (bumped as { layoutVersion: number }[])[0]?.layoutVersion;
  if (nextVersion === undefined) {
    const fresh = await db.query.learningPaths.findFirst({
      where: eq(learningPaths.id, pathId),
      columns: { layoutVersion: true },
    });
    return {
      ok: false,
      error: 'Раскладку изменили в момент сохранения. Обновите карту.',
      conflict: { serverLayoutVersion: fresh?.layoutVersion ?? path.layoutVersion },
    };
  }

  return { ok: true, data: { layoutVersion: nextVersion } };
}

/**
 * Сохранение позиций после перетаскивания на карте.
 * Вызывается с debounce и применяется оптимистично — здесь только запись.
 */
export async function moveNodes(
  input: unknown,
): Promise<ActionResult<{ layoutVersion: number }>> {
  const userId = await requireUserId();
  const parsed = moveNodesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const { pathId, positions, expectedLayoutVersion } = parsed.data;
  return writePositions(userId, pathId, positions, expectedLayoutVersion);
}

/**
 * «Упорядочить»: применение авто-раскладки ко всем узлам пути разом.
 *
 * Перезаписывает и ручные позиции — это заявленное поведение кнопки, а не
 * побочный эффект. Обратимость обеспечивает снимок на клиенте
 * (`lib/layout-snapshot.ts`) и один шаг «Отменить».
 */
export async function arrangeNodes(
  input: unknown,
): Promise<ActionResult<{ layoutVersion: number }>> {
  const userId = await requireUserId();
  const parsed = arrangeNodesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const { pathId, positions, expectedLayoutVersion, grouping } = parsed.data;
  const result = await writePositions(
    userId,
    pathId,
    positions,
    expectedLayoutVersion,
    grouping,
  );

  if (result.ok) revalidatePath(`/paths/${pathId}`);
  return result;
}

export async function deleteNode(input: unknown): Promise<ActionResult<null>> {
  const userId = await requireUserId();
  const parsed = deleteNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const { nodeId, cascade } = parsed.data;
  const pathId = await pathIdOfNode(userId, nodeId);
  if (!pathId) return { ok: false, error: 'Узел не найден' };

  if (!cascade) {
    // Детей поднимаем к родителю удаляемого узла, иначе FK ON DELETE CASCADE
    // снесёт всё поддерево вместе с прогрессом.
    const node = await db.query.knowledgeNodes.findFirst({
      where: eq(knowledgeNodes.id, nodeId),
      columns: { parentId: true, depth: true },
    });
    await db
      .update(knowledgeNodes)
      .set({ parentId: node?.parentId ?? null, depth: node?.depth ?? 0 })
      .where(eq(knowledgeNodes.parentId, nodeId));
  }

  await db.delete(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId));

  revalidatePath(`/paths/${pathId}`);
  return { ok: true, data: null };
}

export async function upsertEdge(input: unknown): Promise<ActionResult<null>> {
  const userId = await requireUserId();
  const parsed = upsertEdgeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const { sourceId, targetId, relation, strength } = parsed.data;
  if (sourceId === targetId) return { ok: false, error: 'Петля недопустима' };

  const sourcePath = await pathIdOfNode(userId, sourceId);
  const targetPath = await pathIdOfNode(userId, targetId);
  if (!sourcePath || !targetPath) return { ok: false, error: 'Узел не найден' };
  if (sourcePath !== targetPath) {
    return { ok: false, error: 'Связь возможна только внутри одного пути' };
  }

  if (relation === 'prerequisite' && (await wouldCreateCycle(db, sourceId, targetId))) {
    return { ok: false, error: 'Связь создаёт цикл зависимостей' };
  }

  await db
    .insert(nodeEdges)
    .values({ sourceId, targetId, relation, strength: strength ?? 0.5 })
    .onConflictDoUpdate({
      target: [nodeEdges.sourceId, nodeEdges.targetId, nodeEdges.relation],
      set: { strength: strength ?? 0.5 },
    });

  revalidatePath(`/paths/${sourcePath}`);
  return { ok: true, data: null };
}

export async function deleteEdge(input: unknown): Promise<ActionResult<null>> {
  const userId = await requireUserId();
  const parsed = deleteEdgeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' };
  }

  const { sourceId, targetId, relation } = parsed.data;
  const pathId = await pathIdOfNode(userId, sourceId);
  if (!pathId) return { ok: false, error: 'Узел не найден' };

  await db
    .delete(nodeEdges)
    .where(
      and(
        eq(nodeEdges.sourceId, sourceId),
        eq(nodeEdges.targetId, targetId),
        eq(nodeEdges.relation, relation),
      ),
    );

  revalidatePath(`/paths/${pathId}`);
  return { ok: true, data: null };
}
