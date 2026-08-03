import { relations } from 'drizzle-orm';

import { aiGenerations, tutorConversations, tutorMessages, userContext } from './agents';
import { assessments, contentBlocks } from './content';
import { fsrsCards, reviewLogs } from './fsrs';
import { knowledgeNodes, learningPaths, nodeEdges, nodeProgress } from './learning';
import { reflections } from './metacognition';
import { practiceSessions, userResponses } from './practice';
import { projects, projectSubmissions } from './projects';
import { nodeSources, sourceChunks, sourceDocuments } from './sources';
import { users } from './users';

export const usersRelations = relations(users, ({ many }) => ({
  paths: many(learningPaths),
  responses: many(userResponses),
  sessions: many(practiceSessions),
  cards: many(fsrsCards),
  reflections: many(reflections),
  contexts: many(userContext),
  conversations: many(tutorConversations),
  submissions: many(projectSubmissions),
}));

export const learningPathsRelations = relations(learningPaths, ({ one, many }) => ({
  user: one(users, { fields: [learningPaths.userId], references: [users.id] }),
  nodes: many(knowledgeNodes),
  projects: many(projects),
}));

export const knowledgeNodesRelations = relations(knowledgeNodes, ({ one, many }) => ({
  path: one(learningPaths, {
    fields: [knowledgeNodes.pathId],
    references: [learningPaths.id],
  }),
  parent: one(knowledgeNodes, {
    fields: [knowledgeNodes.parentId],
    references: [knowledgeNodes.id],
    relationName: 'node_tree',
  }),
  children: many(knowledgeNodes, { relationName: 'node_tree' }),
  progress: one(nodeProgress, {
    fields: [knowledgeNodes.id],
    references: [nodeProgress.nodeId],
  }),
  blocks: many(contentBlocks),
  assessments: many(assessments),
  outgoingEdges: many(nodeEdges, { relationName: 'edge_source' }),
  incomingEdges: many(nodeEdges, { relationName: 'edge_target' }),
  card: one(fsrsCards, { fields: [knowledgeNodes.id], references: [fsrsCards.nodeId] }),
}));

export const nodeEdgesRelations = relations(nodeEdges, ({ one }) => ({
  source: one(knowledgeNodes, {
    fields: [nodeEdges.sourceId],
    references: [knowledgeNodes.id],
    relationName: 'edge_source',
  }),
  target: one(knowledgeNodes, {
    fields: [nodeEdges.targetId],
    references: [knowledgeNodes.id],
    relationName: 'edge_target',
  }),
}));

export const nodeProgressRelations = relations(nodeProgress, ({ one }) => ({
  node: one(knowledgeNodes, {
    fields: [nodeProgress.nodeId],
    references: [knowledgeNodes.id],
  }),
  user: one(users, { fields: [nodeProgress.userId], references: [users.id] }),
}));

export const contentBlocksRelations = relations(contentBlocks, ({ one, many }) => ({
  node: one(knowledgeNodes, {
    fields: [contentBlocks.nodeId],
    references: [knowledgeNodes.id],
  }),
  assessments: many(assessments),
}));

export const assessmentsRelations = relations(assessments, ({ one, many }) => ({
  node: one(knowledgeNodes, {
    fields: [assessments.nodeId],
    references: [knowledgeNodes.id],
  }),
  block: one(contentBlocks, {
    fields: [assessments.contentBlockId],
    references: [contentBlocks.id],
  }),
  responses: many(userResponses),
}));

export const practiceSessionsRelations = relations(practiceSessions, ({ one, many }) => ({
  user: one(users, { fields: [practiceSessions.userId], references: [users.id] }),
  path: one(learningPaths, {
    fields: [practiceSessions.pathId],
    references: [learningPaths.id],
  }),
  primaryNode: one(knowledgeNodes, {
    fields: [practiceSessions.primaryNodeId],
    references: [knowledgeNodes.id],
  }),
  responses: many(userResponses),
}));

export const userResponsesRelations = relations(userResponses, ({ one }) => ({
  user: one(users, { fields: [userResponses.userId], references: [users.id] }),
  session: one(practiceSessions, {
    fields: [userResponses.sessionId],
    references: [practiceSessions.id],
  }),
  assessment: one(assessments, {
    fields: [userResponses.assessmentId],
    references: [assessments.id],
  }),
  node: one(knowledgeNodes, {
    fields: [userResponses.nodeId],
    references: [knowledgeNodes.id],
  }),
}));

export const fsrsCardsRelations = relations(fsrsCards, ({ one, many }) => ({
  user: one(users, { fields: [fsrsCards.userId], references: [users.id] }),
  node: one(knowledgeNodes, {
    fields: [fsrsCards.nodeId],
    references: [knowledgeNodes.id],
  }),
  logs: many(reviewLogs),
}));

export const reviewLogsRelations = relations(reviewLogs, ({ one }) => ({
  card: one(fsrsCards, { fields: [reviewLogs.cardId], references: [fsrsCards.id] }),
  user: one(users, { fields: [reviewLogs.userId], references: [users.id] }),
}));

export const reflectionsRelations = relations(reflections, ({ one }) => ({
  user: one(users, { fields: [reflections.userId], references: [users.id] }),
  node: one(knowledgeNodes, {
    fields: [reflections.nodeId],
    references: [knowledgeNodes.id],
  }),
  path: one(learningPaths, {
    fields: [reflections.pathId],
    references: [learningPaths.id],
  }),
}));

export const userContextRelations = relations(userContext, ({ one }) => ({
  user: one(users, { fields: [userContext.userId], references: [users.id] }),
  path: one(learningPaths, {
    fields: [userContext.pathId],
    references: [learningPaths.id],
  }),
  node: one(knowledgeNodes, {
    fields: [userContext.nodeId],
    references: [knowledgeNodes.id],
  }),
}));

export const tutorConversationsRelations = relations(
  tutorConversations,
  ({ one, many }) => ({
    user: one(users, { fields: [tutorConversations.userId], references: [users.id] }),
    node: one(knowledgeNodes, {
      fields: [tutorConversations.nodeId],
      references: [knowledgeNodes.id],
    }),
    messages: many(tutorMessages),
  }),
);

export const tutorMessagesRelations = relations(tutorMessages, ({ one }) => ({
  conversation: one(tutorConversations, {
    fields: [tutorMessages.conversationId],
    references: [tutorConversations.id],
  }),
}));

export const aiGenerationsRelations = relations(aiGenerations, ({ one }) => ({
  user: one(users, { fields: [aiGenerations.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  path: one(learningPaths, { fields: [projects.pathId], references: [learningPaths.id] }),
  submissions: many(projectSubmissions),
}));

export const projectSubmissionsRelations = relations(projectSubmissions, ({ one }) => ({
  project: one(projects, {
    fields: [projectSubmissions.projectId],
    references: [projects.id],
  }),
  user: one(users, { fields: [projectSubmissions.userId], references: [users.id] }),
}));

export const sourceDocumentsRelations = relations(sourceDocuments, ({ one, many }) => ({
  user: one(users, { fields: [sourceDocuments.userId], references: [users.id] }),
  path: one(learningPaths, {
    fields: [sourceDocuments.pathId],
    references: [learningPaths.id],
  }),
  chunks: many(sourceChunks),
}));

export const sourceChunksRelations = relations(sourceChunks, ({ one, many }) => ({
  document: one(sourceDocuments, {
    fields: [sourceChunks.documentId],
    references: [sourceDocuments.id],
  }),
  nodeLinks: many(nodeSources),
}));

export const nodeSourcesRelations = relations(nodeSources, ({ one }) => ({
  node: one(knowledgeNodes, {
    fields: [nodeSources.nodeId],
    references: [knowledgeNodes.id],
  }),
  chunk: one(sourceChunks, {
    fields: [nodeSources.chunkId],
    references: [sourceChunks.id],
  }),
}));
