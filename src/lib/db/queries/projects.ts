import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { learningPaths, projects, projectSubmissions } from '@/lib/db/schema';

/** Проекты пути — «Проект и защита» (`docs/API.md` §7, PRD §4 сценарий 7). */

export type ProjectListItem = {
  id: string;
  title: string;
  brief: string;
  estimatedHours: number | null;
  latestSubmission: { id: string; status: string; defenseScore: number | null } | null;
};

export async function listProjectsForPath(userId: string, pathId: string): Promise<ProjectListItem[] | null> {
  const path = await db.query.learningPaths.findFirst({
    where: and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)),
  });
  if (!path) return null;

  const rows = await db.select().from(projects).where(eq(projects.pathId, pathId));
  if (rows.length === 0) return [];

  // Батчем по всем проектам разом — тот же приём, что в `getPathGraph`,
  // а не по одному запросу на проект.
  const submissions = await db
    .select()
    .from(projectSubmissions)
    .where(
      and(
        eq(projectSubmissions.userId, userId),
        inArray(
          projectSubmissions.projectId,
          rows.map((p) => p.id),
        ),
      ),
    )
    .orderBy(desc(projectSubmissions.createdAt));

  const latestByProject = new Map<string, (typeof submissions)[number]>();
  for (const submission of submissions) {
    if (!latestByProject.has(submission.projectId)) latestByProject.set(submission.projectId, submission);
  }

  return rows.map((p) => {
    const latest = latestByProject.get(p.id);
    return {
      id: p.id,
      title: p.title,
      brief: p.brief,
      estimatedHours: p.estimatedHours,
      latestSubmission: latest ? { id: latest.id, status: latest.status, defenseScore: latest.defenseScore } : null,
    };
  });
}

export type ProjectDetail = {
  id: string;
  title: string;
  brief: string;
  rubric: { criteria: { id: string; label: string; weight: number; levels: string[] }[]; defenseQuestionSeeds: string[] };
  estimatedHours: number | null;
  submission: { id: string; status: string; defenseScore: number | null } | null;
};

export async function getProjectDetail(userId: string, projectId: string): Promise<ProjectDetail | null> {
  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      brief: projects.brief,
      rubric: projects.rubric,
      estimatedHours: projects.estimatedHours,
      pathUserId: learningPaths.userId,
    })
    .from(projects)
    .innerJoin(learningPaths, eq(learningPaths.id, projects.pathId))
    .where(eq(projects.id, projectId))
    .limit(1);

  const found = rows[0];
  if (!found || found.pathUserId !== userId) return null;

  const submission = await db.query.projectSubmissions.findFirst({
    where: and(eq(projectSubmissions.projectId, projectId), eq(projectSubmissions.userId, userId)),
    orderBy: [desc(projectSubmissions.createdAt)],
  });

  return {
    id: found.id,
    title: found.title,
    brief: found.brief,
    rubric: found.rubric,
    estimatedHours: found.estimatedHours,
    submission: submission ? { id: submission.id, status: submission.status, defenseScore: submission.defenseScore } : null,
  };
}

export type SubmissionForDefense = {
  submissionId: string;
  projectId: string;
  nodeId: string | null;
  coveredNodeIds: string[];
  title: string;
  brief: string;
  criteria: { id: string; label: string; weight: number; levels: string[] }[];
  artifactSummary: string;
  defenseConversationId: string | null;
  status: string;
};

/** Кладёт вместе проект и его рубрику для системного промпта защиты + проверяет владение. */
export async function loadSubmissionForDefense(
  userId: string,
  submissionId: string,
): Promise<SubmissionForDefense | null> {
  const rows = await db
    .select({
      submissionId: projectSubmissions.id,
      submissionUserId: projectSubmissions.userId,
      status: projectSubmissions.status,
      artifactUrl: projectSubmissions.artifactUrl,
      content: projectSubmissions.content,
      defenseConversationId: projectSubmissions.defenseConversationId,
      projectId: projects.id,
      nodeId: projects.nodeId,
      coveredNodeIds: projects.coveredNodeIds,
      title: projects.title,
      brief: projects.brief,
      rubric: projects.rubric,
    })
    .from(projectSubmissions)
    .innerJoin(projects, eq(projects.id, projectSubmissions.projectId))
    .where(eq(projectSubmissions.id, submissionId))
    .limit(1);

  const found = rows[0];
  if (!found || found.submissionUserId !== userId) return null;

  const artifactSummary =
    [
      found.artifactUrl ? `Ссылка на артефакт: ${found.artifactUrl}` : null,
      found.content ? `Текст/описание решения:\n${found.content.slice(0, 6000)}` : null,
    ]
      .filter(Boolean)
      .join('\n\n') || 'Артефакт не содержит текста — только ссылка, либо не заполнен.';

  return {
    submissionId: found.submissionId,
    projectId: found.projectId,
    nodeId: found.nodeId,
    coveredNodeIds: found.coveredNodeIds,
    title: found.title,
    brief: found.brief,
    criteria: found.rubric.criteria,
    artifactSummary,
    defenseConversationId: found.defenseConversationId,
    status: found.status,
  };
}

export async function setDefenseConversationId(submissionId: string, conversationId: string): Promise<void> {
  await db
    .update(projectSubmissions)
    .set({ defenseConversationId: conversationId, status: 'in_defense', updatedAt: new Date() })
    .where(eq(projectSubmissions.id, submissionId));
}
