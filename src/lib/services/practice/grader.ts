import type { Assessment } from '@/lib/db/schema';
import type { UserResponsePayload } from '@/lib/db/schema/types';

/**
 * Проверка ответа — только на сервере (`docs/API.md` §3). Клиент правильного
 * ответа не видит до раскрытия.
 *
 * Реально порождаются только три вида `correctAnswer`
 * (`lib/services/content/mapping.ts::toCorrectAnswer`): `option_ids` (mcq,
 * multi_select), `blanks` (cloze) и `text` (short_answer, free_recall,
 * case_study) — остальные варианты типа существуют в схеме на будущее, но
 * генератор их не производит.
 */

export type GradeResult = { isCorrect: boolean; partialScore: number };

function normalize(text: string, caseSensitive: boolean): string {
  const trimmed = text.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function matchesAccepted(value: string, accepted: string[], caseSensitive: boolean): boolean {
  const normalizedValue = normalize(value, caseSensitive);
  return accepted.some((candidate) => normalize(candidate, caseSensitive) === normalizedValue);
}

export function gradeResponse(assessment: Assessment, response: UserResponsePayload): GradeResult {
  const correct = assessment.correctAnswer;

  if (correct.kind === 'option_ids' && response.kind === 'option_ids') {
    const expected = new Set(correct.ids);
    const given = new Set(response.ids);
    if (expected.size === 0) return { isCorrect: false, partialScore: 0 };
    const overlap = [...given].filter((id) => expected.has(id)).length;
    const extra = [...given].filter((id) => !expected.has(id)).length;
    const isCorrect = overlap === expected.size && extra === 0;
    const partialScore = Math.max(0, (overlap - extra) / expected.size);
    return { isCorrect, partialScore: Math.min(1, partialScore) };
  }

  if (correct.kind === 'blanks' && response.kind === 'blanks') {
    const blankIds = Object.keys(correct.byBlankId);
    if (blankIds.length === 0) return { isCorrect: false, partialScore: 0 };
    const correctCount = blankIds.filter((id) =>
      matchesAccepted(response.byBlankId[id] ?? '', correct.byBlankId[id] ?? [], false),
    ).length;
    return {
      isCorrect: correctCount === blankIds.length,
      partialScore: correctCount / blankIds.length,
    };
  }

  if (correct.kind === 'text' && response.kind === 'text') {
    const isCorrect = matchesAccepted(response.value, correct.accepted, correct.caseSensitive);
    return { isCorrect, partialScore: isCorrect ? 1 : 0 };
  }

  if (correct.kind === 'order' && response.kind === 'order') {
    const positions = correctPositions(correct.ids, response.ids);
    return {
      isCorrect: positions === correct.ids.length && correct.ids.length === response.ids.length,
      partialScore: correct.ids.length === 0 ? 0 : positions / correct.ids.length,
    };
  }

  if (correct.kind === 'pairs' && response.kind === 'pairs') {
    const leftIds = Object.keys(correct.byLeftId);
    if (leftIds.length === 0) return { isCorrect: false, partialScore: 0 };
    const correctCount = leftIds.filter((id) => response.byLeftId[id] === correct.byLeftId[id]).length;
    return {
      isCorrect: correctCount === leftIds.length,
      partialScore: correctCount / leftIds.length,
    };
  }

  if (correct.kind === 'numeric' && response.kind === 'numeric') {
    const payload = assessment.payload.kind === 'estimation' ? assessment.payload : null;
    const tolerance = payload ? payload.tolerancePct / 100 : 0.05;
    const diff = Math.abs(response.value - correct.value);
    const isCorrect = correct.value === 0 ? diff === 0 : diff / Math.abs(correct.value) <= tolerance;
    return { isCorrect, partialScore: isCorrect ? 1 : 0 };
  }

  // Тип ответа не совпал с типом эталона (rubric и т.п. — оценивается вручную/агентом).
  return { isCorrect: false, partialScore: 0 };
}

function correctPositions(expected: string[], given: string[]): number {
  let matches = 0;
  for (let i = 0; i < Math.min(expected.length, given.length); i += 1) {
    if (expected[i] === given[i]) matches += 1;
  }
  return matches;
}
