import { describe, expect, it } from 'vitest';

import {
  assignLayers,
  computeLayout,
  hasOverlaps,
  type LayoutEdge,
  type LayoutGrouping,
  type LayoutNode,
} from './compute-layout';

/**
 * Три свойства, ради которых кнопка «Упорядочить» вообще существует:
 * узлы не накладываются, результат один и тот же при одинаковом входе,
 * порядок изучения читается сверху вниз. Всё остальное — вкусовщина,
 * а эти три ломаются молча.
 */

function node(
  id: string,
  overrides: Partial<LayoutNode> = {},
): LayoutNode {
  return {
    id,
    parentId: null,
    orderIndex: 0,
    status: 'not_started',
    cognitiveLevel: null,
    ...overrides,
  };
}

function chain(length: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes = Array.from({ length }, (_, i) => node(`n${i}`, { orderIndex: i }));
  const edges: LayoutEdge[] = [];
  for (let i = 1; i < length; i++) {
    edges.push({ source: `n${i - 1}`, target: `n${i}`, relation: 'prerequisite' });
  }
  return { nodes, edges };
}

/** Дерево: корень, три ветки по три листа. */
function tree(): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes = [node('root')];
  const edges: LayoutEdge[] = [];
  for (let b = 0; b < 3; b++) {
    nodes.push(node(`b${b}`, { parentId: 'root', orderIndex: b }));
    for (let l = 0; l < 3; l++) {
      nodes.push(node(`b${b}l${l}`, { parentId: `b${b}`, orderIndex: l }));
    }
  }
  return { nodes, edges };
}

const GROUPINGS: LayoutGrouping[] = ['bloom', 'prerequisite', 'status', 'module'];

describe('computeLayout — отсутствие перекрытий', () => {
  it.each(GROUPINGS)('режим «%s»: узлы не накладываются на дереве', (grouping) => {
    const result = computeLayout(tree(), { grouping });
    expect(result.positions).toHaveLength(13);
    expect(hasOverlaps(result.positions)).toBe(false);
  });

  it.each(GROUPINGS)('режим «%s»: узлы не накладываются на длинной цепочке', (grouping) => {
    const result = computeLayout(chain(30), { grouping });
    expect(hasOverlaps(result.positions)).toBe(false);
  });

  it('плотный граф со связями всех типов остаётся без перекрытий', () => {
    const nodes = Array.from({ length: 40 }, (_, i) =>
      node(`n${i}`, {
        orderIndex: i,
        status: ['has_gaps', 'mastered', 'in_progress'][i % 3]!,
        cognitiveLevel: ['recall', 'apply', 'analyze', null][i % 4] ?? null,
      }),
    );
    const edges: LayoutEdge[] = [];
    for (let i = 1; i < 40; i++) {
      edges.push({ source: `n${i - 1}`, target: `n${i}`, relation: 'prerequisite' });
      if (i % 3 === 0) edges.push({ source: `n${i}`, target: `n${i - 3}`, relation: 'related' });
      if (i % 5 === 0) edges.push({ source: `n${i}`, target: `n${i - 5}`, relation: 'contrast' });
    }

    for (const grouping of GROUPINGS) {
      const result = computeLayout({ nodes, edges }, { grouping });
      expect(hasOverlaps(result.positions), `перекрытия в режиме ${grouping}`).toBe(false);
    }
  });
});

describe('computeLayout — детерминированность', () => {
  it('одинаковый вход даёт одинаковый выход', () => {
    const input = tree();
    const a = computeLayout(input, { grouping: 'module' });
    const b = computeLayout(input, { grouping: 'module' });
    expect(a.positions).toEqual(b.positions);
  });

  it('порядок узлов на входе не влияет на результат', () => {
    const input = chain(12);
    const shuffled = {
      nodes: [...input.nodes].reverse(),
      edges: [...input.edges].reverse(),
    };
    expect(computeLayout(shuffled).positions).toEqual(computeLayout(input).positions);
  });

  it('результат не зависит от прогона: десять вызовов совпадают', () => {
    const input = tree();
    const first = computeLayout(input, { grouping: 'status' }).positions;
    for (let i = 0; i < 9; i++) {
      expect(computeLayout(input, { grouping: 'status' }).positions).toEqual(first);
    }
  });
});

describe('assignLayers', () => {
  it('узел стоит ниже всех своих зависимостей, а не ниже ближайшей', () => {
    // n0 → n1 → n2 и одновременно n0 → n2: n2 обязан быть на слое 2, не 1.
    const nodes = [node('n0'), node('n1'), node('n2')];
    const edges: LayoutEdge[] = [
      { source: 'n0', target: 'n1', relation: 'prerequisite' },
      { source: 'n1', target: 'n2', relation: 'prerequisite' },
      { source: 'n0', target: 'n2', relation: 'prerequisite' },
    ];
    const layers = assignLayers(nodes, edges);
    expect(layers.get('n0')).toBe(0);
    expect(layers.get('n1')).toBe(1);
    expect(layers.get('n2')).toBe(2);
  });

  it('ребро-родитель тоже задаёт слой', () => {
    const nodes = [node('root'), node('child', { parentId: 'root' })];
    const layers = assignLayers(nodes, []);
    expect(layers.get('child')).toBe(1);
  });

  it('связи related/contrast не двигают слои', () => {
    const nodes = [node('a'), node('b')];
    const layers = assignLayers(nodes, [{ source: 'a', target: 'b', relation: 'related' }]);
    expect(layers.get('a')).toBe(0);
    expect(layers.get('b')).toBe(0);
  });

  it('цикл в данных не зацикливает раскладку', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges: LayoutEdge[] = [
      { source: 'a', target: 'b', relation: 'prerequisite' },
      { source: 'b', target: 'c', relation: 'prerequisite' },
      { source: 'c', target: 'a', relation: 'prerequisite' },
    ];
    expect(() => assignLayers(nodes, edges)).not.toThrow();
    expect(computeLayout({ nodes, edges }).positions).toHaveLength(3);
  });
});

describe('computeLayout — вертикаль читается как порядок изучения', () => {
  it('зависимость всегда выше зависимого', () => {
    const input = chain(6);
    const byId = new Map(computeLayout(input).positions.map((p) => [p.id, p]));
    for (let i = 1; i < 6; i++) {
      expect(byId.get(`n${i}`)!.y).toBeGreaterThan(byId.get(`n${i - 1}`)!.y);
    }
  });
});

describe('computeLayout — кластеры', () => {
  it('«По статусу» ставит пробелы левее освоенного', () => {
    const nodes = [
      node('gap', { status: 'has_gaps' }),
      node('done', { status: 'mastered' }),
      node('auto', { status: 'automated' }),
    ];
    const result = computeLayout({ nodes, edges: [] }, { grouping: 'status' });
    const byId = new Map(result.positions.map((p) => [p.id, p]));
    expect(byId.get('gap')!.x).toBeLessThan(byId.get('done')!.x);
    expect(byId.get('done')!.x).toBeLessThan(byId.get('auto')!.x);
  });

  it('«По уровням Блума» упорядочивает кластеры от recall к create', () => {
    const nodes = [
      node('create', { cognitiveLevel: 'create' }),
      node('recall', { cognitiveLevel: 'recall' }),
      node('apply', { cognitiveLevel: 'apply' }),
    ];
    const result = computeLayout({ nodes, edges: [] }, { grouping: 'bloom' });
    expect(result.groups.map((g) => g.key)).toEqual(['recall', 'apply', 'create']);
  });

  it('узлы без заданий попадают в отдельный кластер, а не приписываются к recall', () => {
    const nodes = [node('a', { cognitiveLevel: 'recall' }), node('b')];
    const result = computeLayout({ nodes, edges: [] }, { grouping: 'bloom' });
    expect(result.groups.map((g) => g.key)).toEqual(['recall', 'unassessed']);
  });

  it('«По цепочкам» разводит несвязанные компоненты', () => {
    const nodes = [node('a'), node('b'), node('x'), node('y')];
    const edges: LayoutEdge[] = [
      { source: 'a', target: 'b', relation: 'prerequisite' },
      { source: 'x', target: 'y', relation: 'prerequisite' },
    ];
    const result = computeLayout({ nodes, edges }, { grouping: 'prerequisite' });
    expect(result.groups).toHaveLength(2);
    expect(hasOverlaps(result.positions)).toBe(false);
  });

  it('«По модулям» группирует по корню поддерева', () => {
    const nodes = [
      node('m1'),
      node('m1a', { parentId: 'm1' }),
      node('m2'),
      node('m2a', { parentId: 'm2' }),
    ];
    const result = computeLayout({ nodes, edges: [] }, { grouping: 'module' });
    expect(result.groups).toHaveLength(2);
  });
});

describe('computeLayout — краевые случаи', () => {
  it('пустой граф не падает', () => {
    const result = computeLayout({ nodes: [], edges: [] });
    expect(result.positions).toEqual([]);
    expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('один узел', () => {
    expect(computeLayout({ nodes: [node('a')], edges: [] }).positions).toEqual([
      { id: 'a', x: 0, y: 0 },
    ]);
  });

  it('ребро на несуществующий узел игнорируется, а не роняет раскладку', () => {
    const result = computeLayout({
      nodes: [node('a')],
      edges: [{ source: 'a', target: 'нет-такого', relation: 'prerequisite' }],
    });
    expect(result.positions).toHaveLength(1);
  });

  it('bounds покрывают все узлы вместе с их размером', () => {
    const result = computeLayout(chain(4));
    const maxX = Math.max(...result.positions.map((p) => p.x));
    const maxY = Math.max(...result.positions.map((p) => p.y));
    expect(result.bounds.maxX).toBeGreaterThan(maxX);
    expect(result.bounds.maxY).toBeGreaterThan(maxY);
  });
});
