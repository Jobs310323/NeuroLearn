import { describe, expect, it } from 'vitest';

import { computeLockedNodes } from './acyclic';

describe('computeLockedNodes', () => {
  const nodes = [
    { id: 'a', status: 'mastered' },
    { id: 'b', status: 'in_progress' },
    { id: 'c', status: 'not_started' },
    { id: 'd', status: 'automated' },
  ];

  it('блокирует узел, если предпосылка не освоена', () => {
    const locked = computeLockedNodes(nodes, [
      { source: 'b', target: 'c', relation: 'prerequisite' },
    ]);
    expect([...locked]).toEqual(['c']);
  });

  it('не блокирует, если предпосылка mastered или automated', () => {
    const locked = computeLockedNodes(nodes, [
      { source: 'a', target: 'c', relation: 'prerequisite' },
      { source: 'd', target: 'b', relation: 'prerequisite' },
    ]);
    expect(locked.size).toBe(0);
  });

  it('игнорирует рёбра интерливинга — они не создают зависимости', () => {
    const locked = computeLockedNodes(nodes, [
      { source: 'b', target: 'c', relation: 'related' },
      { source: 'c', target: 'b', relation: 'contrast' },
      { source: 'b', target: 'd', relation: 'analogous' },
    ]);
    expect(locked.size).toBe(0);
  });

  it('блокирует, если хотя бы одна из нескольких предпосылок не готова', () => {
    const locked = computeLockedNodes(nodes, [
      { source: 'a', target: 'c', relation: 'prerequisite' },
      { source: 'b', target: 'c', relation: 'prerequisite' },
    ]);
    expect([...locked]).toEqual(['c']);
  });
});
