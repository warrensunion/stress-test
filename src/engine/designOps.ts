import { COMPONENT_SPECS } from './components';
import { newId } from './schema';
import type { ComponentType, Design, DesignNode, NodeParams } from './types';

// Immutable edit operations on a Design. Used by the canvas and by auto-fixes.

export function addNode(d: Design, type: ComponentType, position: { x: number; y: number }, label?: string): [Design, string] {
  const spec = COMPONENT_SPECS[type];
  const id = newId(type, d.nodes.map((n) => n.id));
  const sameType = d.nodes.filter((n) => n.type === type).length;
  const node: DesignNode = {
    id,
    type,
    label: label ?? (sameType ? `${spec.label} ${sameType + 1}` : spec.label),
    position,
    params: { ...spec.defaults },
  };
  return [{ ...d, nodes: [...d.nodes, node] }, id];
}

export function removeNodes(d: Design, ids: string[]): Design {
  const gone = new Set(ids);
  return {
    ...d,
    nodes: d.nodes.filter((n) => !gone.has(n.id)),
    edges: d.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
  };
}

export function addEdge(d: Design, source: string, target: string): Design {
  if (source === target) return d;
  if (d.edges.some((e) => e.source === source && e.target === target)) return d;
  const id = newId(`e-${source}-${target}`, d.edges.map((e) => e.id));
  return { ...d, edges: [...d.edges, { id, source, target }] };
}

export function removeEdges(d: Design, ids: string[]): Design {
  const gone = new Set(ids);
  return { ...d, edges: d.edges.filter((e) => !gone.has(e.id)) };
}

export function updateNode(d: Design, id: string, patch: Partial<Omit<DesignNode, 'params'>> & { params?: Partial<NodeParams> }): Design {
  return {
    ...d,
    nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch, params: { ...n.params, ...patch.params } } : n)),
  };
}

export function moveNodes(d: Design, positions: Record<string, { x: number; y: number }>): Design {
  return { ...d, nodes: d.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)) };
}
