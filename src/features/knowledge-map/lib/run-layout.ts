import {
  computeLayout,
  type LayoutEdge,
  type LayoutGrouping,
  type LayoutNode,
  type Positioned,
} from './compute-layout';
import type { LayoutRequest, LayoutResponse } from './layout.worker';

/**
 * Единая точка вызова раскладки из UI: сама решает, считать в основном потоке
 * или отдать воркеру.
 *
 * Компонент карты про воркер знать не должен — иначе выбор «где считать»
 * расползётся по обработчикам кнопок, и однажды один из них останется
 * синхронным на графе в тысячу узлов.
 */

/** Ниже порога перенос в воркер дороже самого расчёта. */
export const WORKER_THRESHOLD = 200;

export function needsWorker(nodeCount: number): boolean {
  return nodeCount >= WORKER_THRESHOLD;
}

export async function runLayout(
  input: { nodes: LayoutNode[]; edges: LayoutEdge[] },
  grouping: LayoutGrouping,
): Promise<Positioned[]> {
  if (!needsWorker(input.nodes.length) || typeof Worker === 'undefined') {
    return computeLayout(input, { grouping }).positions;
  }

  try {
    return await inWorker(input, grouping);
  } catch {
    // Воркер мог не подняться (жёсткий CSP, старый браузер). Раскладка —
    // не та функция, ради которой стоит показывать ошибку: считаем здесь же,
    // ценой подвисания кадра на большом графе.
    return computeLayout(input, { grouping }).positions;
  }
}

function inWorker(
  input: { nodes: LayoutNode[]; edges: LayoutEdge[] },
  grouping: LayoutGrouping,
): Promise<Positioned[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), {
      type: 'module',
    });
    const requestId = crypto.randomUUID();

    // Воркер, который не ответил, обязан быть закрыт: иначе каждая неудачная
    // раскладка оставляет висящий поток до перезагрузки вкладки.
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Раскладка не ответила вовремя'));
    }, 10_000);

    worker.addEventListener('message', (event: MessageEvent<LayoutResponse>) => {
      if (event.data.requestId !== requestId) return;
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data.positions);
    });

    worker.addEventListener('error', (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message));
    });

    const request: LayoutRequest = { requestId, nodes: input.nodes, edges: input.edges, grouping };
    worker.postMessage(request);
  });
}
