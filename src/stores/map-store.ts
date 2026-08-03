import { create } from 'zustand';

import type { NodeStatus } from '@/features/knowledge-map/lib/node-status';

/**
 * Только эфемерное состояние карты. Серверные данные живут в React Query —
 * дублировать их здесь запрещено (правило разделения состояний, ARCHITECTURE §1).
 */
type MapState = {
  selectedNodeId: string | null;
  hiddenStatuses: Set<NodeStatus>;
  linkingFrom: string | null;

  select: (nodeId: string | null) => void;
  toggleStatusFilter: (status: NodeStatus) => void;
  startLinking: (nodeId: string) => void;
  cancelLinking: () => void;
};

export const useMapStore = create<MapState>((set) => ({
  selectedNodeId: null,
  hiddenStatuses: new Set(),
  linkingFrom: null,

  select: (nodeId) => set({ selectedNodeId: nodeId }),

  toggleStatusFilter: (status) =>
    set((state) => {
      const next = new Set(state.hiddenStatuses);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return { hiddenStatuses: next };
    }),

  startLinking: (nodeId) => set({ linkingFrom: nodeId }),
  cancelLinking: () => set({ linkingFrom: null }),
}));
