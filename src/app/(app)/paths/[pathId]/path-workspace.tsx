'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { KnowledgeMap } from '@/features/knowledge-map/components/knowledge-map';
import { NodeInspector } from '@/features/knowledge-map/components/node-inspector';
import { createNode } from '@/features/knowledge-map/actions';
import type { PathGraph } from '@/lib/db/queries/paths';
import { useMapStore } from '@/stores/map-store';

/**
 * Рабочая область пути: карта знаний слева, инспектор выбранного узла справа.
 * Данные приходят с сервера одним срезом; после мутаций делаем `router.refresh()`.
 */
export function PathWorkspace({ graph }: { graph: PathGraph }) {
  const router = useRouter();
  const selectedNodeId = useMapStore((s) => s.selectedNodeId);
  const select = useMapStore((s) => s.select);
  const [pending, setPending] = useState(false);

  const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;

  async function addRootNode() {
    setPending(true);
    const result = await createNode({
      pathId: graph.path.id,
      title: 'Новый узел',
      position: { x: 0, y: (graph.nodes.length % 6) * 130 },
    });
    setPending(false);
    if (result.ok) {
      select(result.data.nodeId);
      router.refresh();
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{graph.path.title}</h1>
          <p className="truncate text-xs text-fg-subtle">{graph.path.goal}</p>
        </div>

        <Button size="sm" variant="secondary" onClick={addRootNode} disabled={pending}>
          <Plus aria-hidden />
          Узел
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <KnowledgeMap graph={graph} />
        </div>

        {selectedNode ? (
          <NodeInspector
            key={selectedNode.id}
            node={selectedNode}
            pathId={graph.path.id}
            siblings={graph.nodes}
            edges={graph.edges}
          />
        ) : null}
      </div>
    </div>
  );
}
