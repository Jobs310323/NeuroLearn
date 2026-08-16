import { describe, expect, it } from 'vitest';

import { decodeDraft, encodeDraft, type PracticeDraft } from './draft';

/**
 * `sessionDraftId` непрозрачен, но не подписан — подделка здесь ловится
 * только по форме, а владение перепроверяется в `POST /api/practice/sessions`
 * (запрос по `learningPaths.userId`). Тесты фиксируют обе половины контракта:
 * что валидный черновик переживает roundtrip и что мусор даёт `null`,
 * а не частично заполненный объект.
 */

const draft: PracticeDraft = {
  nodeId: '11111111-1111-1111-1111-111111111111',
  mode: 'interleaved',
  mix: true,
  interleaveRatio: 0.3,
  sourceNodeIds: ['22222222-2222-2222-2222-222222222222'],
  assessmentIds: ['33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'],
};

describe('encodeDraft / decodeDraft', () => {
  it('переживает roundtrip без потерь', () => {
    expect(decodeDraft(encodeDraft(draft))).toEqual(draft);
  });

  it('сохраняет порядок заданий — на нём строится itemOrder сессии', () => {
    expect(decodeDraft(encodeDraft(draft))?.assessmentIds).toEqual(draft.assessmentIds);
  });

  it('не содержит читаемого JSON в токене', () => {
    expect(encodeDraft(draft)).not.toContain('assessmentIds');
  });

  it('возвращает null на мусоре', () => {
    expect(decodeDraft('не-токен')).toBeNull();
  });

  it('возвращает null на обрезанном токене', () => {
    const token = encodeDraft(draft);
    expect(decodeDraft(token.slice(0, token.length - 10))).toBeNull();
  });

  it('возвращает null, если assessmentIds не массив', () => {
    const forged = Buffer.from(JSON.stringify({ ...draft, assessmentIds: 'всё' }), 'utf8').toString('base64url');
    expect(decodeDraft(forged)).toBeNull();
  });

  it('возвращает null, если sourceNodeIds не массив', () => {
    const forged = Buffer.from(JSON.stringify({ ...draft, sourceNodeIds: null }), 'utf8').toString('base64url');
    expect(decodeDraft(forged)).toBeNull();
  });

  it('возвращает null, если nodeId не строка', () => {
    const forged = Buffer.from(JSON.stringify({ ...draft, nodeId: 42 }), 'utf8').toString('base64url');
    expect(decodeDraft(forged)).toBeNull();
  });

  it('возвращает null на валидном base64 с не-объектом внутри', () => {
    const forged = Buffer.from('"строка"', 'utf8').toString('base64url');
    expect(decodeDraft(forged)).toBeNull();
  });
});
