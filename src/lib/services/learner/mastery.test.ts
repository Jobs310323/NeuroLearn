import { describe, expect, it } from 'vitest';

import { MASTERY_SCALE, masteryLabel } from './mastery';

/**
 * Ошибка в шкале была бы незаметной: подпись «Автоматизм» под прочностью 40
 * никто не поймает глазами на одном экране, а доверие к числу она подорвёт
 * целиком.
 */
describe('masteryLabel', () => {
  it('нижняя и верхняя границы', () => {
    expect(masteryLabel(0).label).toBe('Знакомство');
    expect(masteryLabel(100).label).toBe('Автоматизм');
  });

  it('подпись меняется ровно на границе, а не около неё', () => {
    expect(masteryLabel(24).label).toBe('Знакомство');
    expect(masteryLabel(25).label).toBe('Понимание');
    expect(masteryLabel(79).label).toBe('Применение');
    expect(masteryLabel(80).label).toBe('Мастерство');
    expect(masteryLabel(94).label).toBe('Мастерство');
    expect(masteryLabel(95).label).toBe('Автоматизм');
  });

  it('шкала упорядочена по возрастанию — иначе выбор ступени неоднозначен', () => {
    const bounds = MASTERY_SCALE.map((step) => step.from);
    expect([...bounds].sort((a, b) => a - b)).toEqual(bounds);
  });

  it('у каждой ступени есть пояснение: одна подпись без него — это очки', () => {
    for (const step of MASTERY_SCALE) {
      expect(step.description.length).toBeGreaterThan(10);
    }
  });
});
