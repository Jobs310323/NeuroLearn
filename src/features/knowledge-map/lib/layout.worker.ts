import { computeLayout, type LayoutEdge, type LayoutGrouping, type LayoutNode } from './compute-layout';

/**
 * Раскладка больших графов вне основного потока.
 *
 * Порог включения — 200 узлов (`WORKER_THRESHOLD`). Ниже него перенос в
 * воркер только вредит: сериализация графа туда и обратно стоит дороже самого
 * расчёта, а на карте появляется мигание скелетона там, где раньше было
 * мгновенно.
 *
 * Воркер вызывает ровно ту же чистую функцию, что и основной поток, — двух
 * реализаций раскладки в проекте нет, иначе они неизбежно разойдутся и
 * «Упорядочить» начнёт давать разный результат в зависимости от размера
 * графа.
 */

export type LayoutRequest = {
  requestId: string;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  grouping: LayoutGrouping;
};

export type LayoutResponse = {
  requestId: string;
  positions: { id: string; x: number; y: number }[];
};

self.addEventListener('message', (event: MessageEvent<LayoutRequest>) => {
  const { requestId, nodes, edges, grouping } = event.data;
  const result = computeLayout({ nodes, edges }, { grouping });
  const message: LayoutResponse = { requestId, positions: result.positions };
  (self as unknown as Worker).postMessage(message);
});
