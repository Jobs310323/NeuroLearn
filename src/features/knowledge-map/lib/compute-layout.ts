/**
 * Детерминированная раскладка дерева знаний.
 *
 * Почему свой движок, а не elkjs/dagre. В репозитории уже принято решение
 * против elkjs (см. историю `layout.ts`): он асинхронный, тянет воркер и
 * меняет порядок узлов между версиями. Для кнопки «Упорядочить» это
 * критично — одинаковый граф обязан давать одинаковую картинку, иначе
 * человек нажимает её дважды и получает две разные карты, а тест на
 * детерминированность написать не на чем. Здесь алгоритм слоёв Сугиямы в
 * усечённом виде: назначение слоёв, барицентрическое упорядочивание с
 * фиксированным числом проходов, разведение перекрытий. Всё синхронно,
 * без DOM и без случайности.
 *
 * Интерфейс сознательно узкий (`computeLayout(input, options)`) — если
 * когда-нибудь появится причина заменить реализацию библиотекой, менять
 * придётся один файл.
 */

export type LayoutNode = {
  id: string;
  parentId: string | null;
  orderIndex: number;
  status: string;
  /** Преобладающий уровень Блума по заданиям узла. `null`, если заданий нет. */
  cognitiveLevel: string | null;
};

export type LayoutEdge = { source: string; target: string; relation: string };

export type LayoutGrouping = 'bloom' | 'prerequisite' | 'status' | 'module';

export type LayoutOptions = {
  grouping?: LayoutGrouping;
  nodeWidth?: number;
  nodeHeight?: number;
  /** Минимальный зазор между узлами по горизонтали. */
  hGap?: number;
  /** Расстояние между слоями по вертикали. */
  vGap?: number;
  /** Зазор между кластерами группировки. */
  groupGap?: number;
};

export type Positioned = { id: string; x: number; y: number };

export type LayoutResult = {
  positions: Positioned[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Кластеры в порядке размещения — для подписей и легенды. */
  groups: { key: string; label: string; minX: number; maxX: number }[];
};

const DEFAULTS = {
  nodeWidth: 240,
  nodeHeight: 96,
  hGap: 48,
  vGap: 150,
  groupGap: 160,
} as const;

/** Порядок Блума значим: он же задаёт порядок кластеров слева направо. */
const BLOOM_ORDER = ['recall', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

/**
 * Порядок статусов в режиме «По статусу»: сначала то, что требует внимания.
 * Пробелы рядом с «нужно повторить» — это и есть рабочая зона; освоенное
 * уезжает вправо, потому что смотреть на него каждый день незачем.
 */
const STATUS_ORDER = [
  'has_gaps',
  'needs_review',
  'in_progress',
  'not_started',
  'mastered',
  'automated',
];

const STATUS_LABEL: Record<string, string> = {
  has_gaps: 'Есть пробелы',
  needs_review: 'Нужно повторить',
  in_progress: 'В работе',
  not_started: 'Не начаты',
  mastered: 'Освоены',
  automated: 'Автоматизм',
};

const BLOOM_LABEL: Record<string, string> = {
  recall: 'Вспомнить',
  understand: 'Понять',
  apply: 'Применить',
  analyze: 'Проанализировать',
  evaluate: 'Оценить',
  create: 'Создать',
};

export function computeLayout(
  input: { nodes: LayoutNode[]; edges: LayoutEdge[] },
  options: LayoutOptions = {},
): LayoutResult {
  const opts = { ...DEFAULTS, grouping: 'bloom' as LayoutGrouping, ...options };
  const nodes = [...input.nodes].sort(compareNodes);

  if (nodes.length === 0) {
    return { positions: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, groups: [] };
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Рёбра к отсутствующим узлам игнорируются: срез пути мог прийти без части
  // графа, и падать из-за этого раскладка не должна.
  const edges = input.edges.filter((e) => byId.has(e.source) && byId.has(e.target));

  const groups = partition(nodes, edges, opts.grouping);

  const positions: Positioned[] = [];
  const groupBounds: LayoutResult['groups'] = [];
  let cursorX = 0;

  for (const group of groups) {
    const groupNodeIds = new Set(group.nodes.map((n) => n.id));
    const groupEdges = edges.filter(
      (e) => groupNodeIds.has(e.source) && groupNodeIds.has(e.target),
    );

    const placed = layoutGroup(group.nodes, groupEdges, opts);
    const width = placed.length === 0 ? 0 : Math.max(...placed.map((p) => p.x)) + opts.nodeWidth;

    for (const item of placed) positions.push({ ...item, x: item.x + cursorX });
    groupBounds.push({
      key: group.key,
      label: group.label,
      minX: cursorX,
      maxX: cursorX + width,
    });

    cursorX += width + opts.groupGap;
  }

  return { positions, bounds: computeBounds(positions, opts), groups: groupBounds };
}

/**
 * Порядок узлов на входе фиксируется явно. Барицентрический проход
 * чувствителен к исходному порядку, а порядок строк из базы гарантирован
 * не полностью — без этой сортировки «одинаковый вход» переставал быть
 * одинаковым, и детерминированность держалась бы на удаче.
 */
function compareNodes(a: LayoutNode, b: LayoutNode): number {
  if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
  return a.id.localeCompare(b.id);
}

// --- Группировка --------------------------------------------------------

type Group = { key: string; label: string; nodes: LayoutNode[] };

function partition(nodes: LayoutNode[], edges: LayoutEdge[], grouping: LayoutGrouping): Group[] {
  switch (grouping) {
    case 'status':
      return groupByKey(
        nodes,
        (node) => node.status,
        (key) => STATUS_LABEL[key] ?? key,
        STATUS_ORDER,
      );
    case 'bloom':
      return groupByKey(
        nodes,
        (node) => node.cognitiveLevel ?? 'unassessed',
        (key) => (key === 'unassessed' ? 'Без заданий' : (BLOOM_LABEL[key] ?? key)),
        [...BLOOM_ORDER, 'unassessed'],
      );
    case 'module':
      return groupByKey(
        nodes,
        (node) => rootOf(node, nodes),
        (key) => nodes.find((n) => n.id === key)?.id ?? key,
        [],
      );
    case 'prerequisite':
      return prerequisiteChains(nodes, edges);
  }
}

function groupByKey(
  nodes: LayoutNode[],
  keyOf: (node: LayoutNode) => string,
  labelOf: (key: string) => string,
  preferredOrder: string[],
): Group[] {
  const buckets = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    const key = keyOf(node);
    const list = buckets.get(key);
    if (list) list.push(node);
    else buckets.set(key, [node]);
  }

  const rank = (key: string) => {
    const index = preferredOrder.indexOf(key);
    return index === -1 ? preferredOrder.length : index;
  };

  return [...buckets.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([key, groupNodes]) => ({ key, label: labelOf(key), nodes: groupNodes }));
}

/** Корень поддерева по `parentId`. Цикл в дереве обрывается по длине пути. */
function rootOf(node: LayoutNode, nodes: LayoutNode[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let current = node;
  for (let guard = 0; guard < nodes.length; guard++) {
    if (!current.parentId) return current.id;
    const parent = byId.get(current.parentId);
    if (!parent) return current.id;
    current = parent;
  }
  return current.id;
}

/**
 * Цепочки зависимостей — слабо связные компоненты по рёбрам `prerequisite`.
 * Именно они и есть «цепочка»: узлы, которые нельзя учить в отрыве друг от
 * друга. Остальные типы рёбер сюда не входят — они связывают темы, а не
 * порядок изучения.
 */
function prerequisiteChains(nodes: LayoutNode[], edges: LayoutEdge[]): Group[] {
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Сжатие пути: без него глубокие цепочки дают квадратичное время.
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };

  for (const edge of edges) {
    if (edge.relation !== 'prerequisite') continue;
    const a = find(edge.source);
    const b = find(edge.target);
    if (a !== b) parent.set(a, b);
  }
  // Узлы дерева без явных рёбер всё равно связаны родителем.
  for (const node of nodes) {
    if (!node.parentId || !parent.has(node.parentId)) continue;
    const a = find(node.id);
    const b = find(node.parentId);
    if (a !== b) parent.set(a, b);
  }

  const buckets = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    const key = find(node.id);
    const list = buckets.get(key);
    if (list) list.push(node);
    else buckets.set(key, [node]);
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, groupNodes], index) => ({
      key,
      label: `Цепочка ${index + 1}`,
      nodes: groupNodes,
    }));
}

// --- Раскладка одной группы ---------------------------------------------

type Resolved = Required<LayoutOptions>;

function layoutGroup(nodes: LayoutNode[], edges: LayoutEdge[], opts: Resolved): Positioned[] {
  const layers = assignLayers(nodes, edges);
  const ordered = orderWithinLayers(nodes, edges, layers);
  return assignCoordinates(ordered, opts);
}

/**
 * Слой узла — длиннейший путь до него по рёбрам порядка (`prerequisite` и
 * связь «родитель → ребёнок»). Длиннейший, а не кратчайший: узел обязан
 * стоять ниже ВСЕХ своих зависимостей, иначе стрелка идёт вверх и картинка
 * врёт о порядке изучения.
 *
 * Цикл (испорченные данные — обычно граф ациклический) обрывается по числу
 * проходов: раскладка не имеет права зациклиться из-за плохой строки в базе.
 */
export function assignLayers(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  for (const node of nodes) incoming.set(node.id, []);

  for (const edge of edges) {
    if (edge.relation !== 'prerequisite') continue;
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    incoming.get(edge.target)!.push(edge.source);
  }
  for (const node of nodes) {
    if (node.parentId && ids.has(node.parentId)) {
      incoming.get(node.id)!.push(node.parentId);
    }
  }

  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));

  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const node of nodes) {
      const deps = incoming.get(node.id)!;
      let want = 0;
      for (const dep of deps) want = Math.max(want, (layer.get(dep) ?? 0) + 1);
      if (want > (layer.get(node.id) ?? 0)) {
        layer.set(node.id, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return layer;
}

/**
 * Барицентрический проход: узел тянется к среднему положению соседей на
 * соседнем слое. Число проходов фиксировано (4) — эвристика сходится быстро,
 * а «до сходимости» означало бы разное число итераций на разных графах и,
 * значит, разный результат при неудачном тай-брейке.
 *
 * Рёбра `related`/`contrast`/`analogous` учитываются с малым весом: они
 * влияют на соседство, но не должны спорить с порядком изучения.
 */
const SOFT_WEIGHT = 0.25;
const BARYCENTER_PASSES = 4;

function orderWithinLayers(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  layers: Map<string, number>,
): LayoutNode[][] {
  const maxLayer = Math.max(0, ...[...layers.values()]);
  const byLayer: LayoutNode[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const node of nodes) byLayer[layers.get(node.id) ?? 0]!.push(node);

  const neighbours = new Map<string, { id: string; weight: number }[]>();
  const add = (from: string, to: string, weight: number) => {
    const list = neighbours.get(from);
    if (list) list.push({ id: to, weight });
    else neighbours.set(from, [{ id: to, weight }]);
  };
  for (const edge of edges) {
    const weight = edge.relation === 'prerequisite' ? 1 : SOFT_WEIGHT;
    add(edge.source, edge.target, weight);
    add(edge.target, edge.source, weight);
  }
  for (const node of nodes) {
    if (node.parentId) {
      add(node.id, node.parentId, 1);
      add(node.parentId, node.id, 1);
    }
  }

  const indexOf = new Map<string, number>();
  const reindex = () => {
    for (const layer of byLayer) {
      layer.forEach((node, index) => indexOf.set(node.id, index));
    }
  };
  reindex();

  for (let pass = 0; pass < BARYCENTER_PASSES; pass++) {
    // Проходы чередуются сверху вниз и снизу вверх: односторонний проход
    // выравнивает только одну сторону рёбер.
    const order = pass % 2 === 0 ? byLayer : [...byLayer].reverse();
    for (const layer of order) {
      const bary = new Map<string, number>();
      for (const node of layer) {
        const list = neighbours.get(node.id) ?? [];
        let sum = 0;
        let weight = 0;
        for (const link of list) {
          const position = indexOf.get(link.id);
          if (position === undefined) continue;
          sum += position * link.weight;
          weight += link.weight;
        }
        bary.set(node.id, weight === 0 ? (indexOf.get(node.id) ?? 0) : sum / weight);
      }
      layer.sort(
        (a, b) => (bary.get(a.id) ?? 0) - (bary.get(b.id) ?? 0) || compareNodes(a, b),
      );
      reindex();
    }
  }

  return byLayer;
}

/**
 * Координаты и разведение перекрытий. Каждый узел на своём слое получает
 * ячейку шириной `nodeWidth + hGap`, поэтому перекрытий не бывает по
 * построению — а не «почти не бывает после подгонки».
 *
 * Слои центрируются относительно самого широкого: иначе дерево прижимается
 * к левому краю и выглядит незаконченным.
 */
function assignCoordinates(layers: LayoutNode[][], opts: Resolved): Positioned[] {
  const step = opts.nodeWidth + opts.hGap;
  const widest = Math.max(1, ...layers.map((layer) => layer.length));
  const totalWidth = widest * step;

  const positions: Positioned[] = [];
  layers.forEach((layer, depth) => {
    const layerWidth = layer.length * step;
    const offset = (totalWidth - layerWidth) / 2;
    layer.forEach((node, index) => {
      positions.push({
        id: node.id,
        x: Math.round(offset + index * step),
        y: depth * (opts.nodeHeight + opts.vGap),
      });
    });
  });

  return positions.sort((a, b) => a.id.localeCompare(b.id));
}

function computeBounds(positions: Positioned[], opts: Resolved) {
  if (positions.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs) + opts.nodeWidth,
    maxY: Math.max(...ys) + opts.nodeHeight,
  };
}

/**
 * Пересекаются ли прямоугольники узлов. Используется тестом и проверкой
 * результата воркера — оба места должны считать перекрытие одинаково.
 */
export function hasOverlaps(
  positions: Positioned[],
  nodeWidth = DEFAULTS.nodeWidth,
  nodeHeight = DEFAULTS.nodeHeight,
): boolean {
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i]!;
      const b = positions[j]!;
      if (
        Math.abs(a.x - b.x) < nodeWidth &&
        Math.abs(a.y - b.y) < nodeHeight
      ) {
        return true;
      }
    }
  }
  return false;
}

export const LAYOUT_DEFAULTS = DEFAULTS;

export const LAYOUT_GROUPING_LABEL: Record<LayoutGrouping, string> = {
  bloom: 'По уровням Блума',
  prerequisite: 'По цепочкам зависимостей',
  status: 'По статусу',
  module: 'По модулям',
};
