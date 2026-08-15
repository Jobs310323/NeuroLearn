'use client';

import { Plus, Sparkles } from 'lucide-react';
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

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

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

  async function generateTree() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const response = await fetch('/api/ai/generate/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathId: graph.path.id }),
      });
      const body = await response.json();
      if (!response.ok) {
        setGenerateError(body.error?.message ?? 'Не удалось сгенерировать дерево');
        return;
      }
      router.refresh();
    } catch {
      setGenerateError('Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{graph.path.title}</h1>
          <p className="truncate text-xs text-fg-subtle">{graph.path.goal}</p>
        </div>

        <div className="flex items-center gap-2">
          {graph.nodes.length === 0 ? (
            <Button size="sm" onClick={() => void generateTree()} disabled={generating}>
              <Sparkles aria-hidden />
              {generating ? 'Генерирую…' : 'Сгенерировать дерево'}
            </Button>
          ) : null}

          <Button size="sm" variant="secondary" onClick={addRootNode} disabled={pending}>
            <Plus aria-hidden />
            Узел
          </Button>
        </div>
      </header>

      {generateError ? (
        <p className="border-b border-border bg-red-500/10 px-6 py-2 text-xs text-red-400">
          {generateError}
        </p>
      ) : null}

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
