import {
  Background,
  Controls,
  MarkerType,

  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  applyNodeChanges,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { addEdge, addNode, moveNodes, removeEdges, removeNodes } from '../engine/designOps';
import type { ComponentType, Design } from '../engine/types';
import { SystemNode, type NodeDecor, type SystemFlowNode } from './SystemNode';

const nodeTypes = { system: SystemNode };

export type { NodeDecor };

interface Props {
  design: Design;
  onChange: (d: Design) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  decor: Record<string, Partial<NodeDecor>>;
  activeEdges?: boolean;
}

export const DRAG_MIME = 'application/x-stress-test-component';

export function DesignCanvas({ design, onChange, selectedId, onSelect, decor, activeEdges }: Props) {
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Re-frame the view when nodes are added or removed (e.g. by an auto-fix).
  const nodeCount = design.nodes.length;
  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.2, duration: 200 }), 50);
    return () => clearTimeout(t);
  }, [nodeCount, fitView]);

  // React Flow needs to keep its own measured sizes on node objects, so we hold RF nodes in
  // local state and re-sync them from the design (the source of truth) whenever it changes.
  const [nodes, setNodes] = useState<SystemFlowNode[]>([]);
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return design.nodes.map((dn) => ({
        ...byId.get(dn.id),
        id: dn.id,
        type: 'system' as const,
        position: dn.position,
        selected: dn.id === selectedId,
        data: { issues: [], ...decor[dn.id], dn },
      }));
    });
  }, [design.nodes, selectedId, decor]);

  const edges: Edge[] = useMemo(
    () =>
      design.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: activeEdges,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: design.nodes.find((n) => n.id === e.target)?.type === 'queue' ? { strokeDasharray: '6 4' } : undefined,
      })),
    [design.edges, design.nodes, activeEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<SystemFlowNode>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      const positions: Record<string, { x: number; y: number }> = {};
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === 'position' && c.position) positions[c.id] = c.position;
        else if (c.type === 'remove') removed.push(c.id);
        else if (c.type === 'select') {
          if (c.selected) onSelect(c.id);
          else if (c.id === selectedId) onSelect(null);
        }
      }
      let next = design;
      if (Object.keys(positions).length) next = moveNodes(next, positions);
      if (removed.length) next = removeNodes(next, removed);
      if (next !== design) onChange(next);
    },
    [design, onChange, onSelect, selectedId],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removed.length) onChange(removeEdges(design, removed));
    },
    [design, onChange],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) onChange(addEdge(design, c.source, c.target));
    },
    [design, onChange],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DRAG_MIME) as ComponentType;
      if (!type) return;
      const [next, id] = addNode(design, type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      onChange(next);
      onSelect(id);
    },
    [design, onChange, onSelect, screenToFlowPosition],
  );

  return (
    <div className="h-full w-full" onDrop={onDrop} onDragOver={(e) => e.preventDefault()} data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
