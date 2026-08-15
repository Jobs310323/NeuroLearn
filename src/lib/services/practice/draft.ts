import type { practiceModeEnum } from '@/lib/db/schema/enums';

type PracticeMode = (typeof practiceModeEnum.enumValues)[number];

/**
 * `GET /api/practice/next` фиксирует состав набора и возвращает его клиенту
 * как непрозрачный `sessionDraftId` (`docs/API.md` §3). Отдельной таблицы
 * под черновики нет — на масштабе персонального приложения дешевле не
 * заводить сущность и не чистить её: состав кодируется прямо в идентификатор,
 * а владение переданными `assessmentId` перепроверяется на `POST /sessions`.
 */

export type PracticeDraft = {
  nodeId: string;
  mode: PracticeMode;
  mix: boolean;
  interleaveRatio: number;
  sourceNodeIds: string[];
  assessmentIds: string[];
};

export function encodeDraft(draft: PracticeDraft): string {
  return Buffer.from(JSON.stringify(draft), 'utf8').toString('base64url');
}

export function decodeDraft(token: string): PracticeDraft | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as PracticeDraft).assessmentIds) ||
      !Array.isArray((parsed as PracticeDraft).sourceNodeIds) ||
      typeof (parsed as PracticeDraft).nodeId !== 'string'
    ) {
      return null;
    }
    return parsed as PracticeDraft;
  } catch {
    return null;
  }
}
