import type { Design, DesignNode } from './types';

export interface Graph {
  nodes: Map<string, DesignNode>;
  outs: Map<string, string[]>;
  ins: Map<string, string[]>;
}

export function buildGraph(d: Design): Graph {
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const outs = new Map<string, string[]>(d.nodes.map((n) => [n.id, []]));
  const ins = new Map<string, string[]>(d.nodes.map((n) => [n.id, []]));
  for (const e of d.edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
    const o = outs.get(e.source)!;
    if (!o.includes(e.target)) o.push(e.target);
    const i = ins.get(e.target)!;
    if (!i.includes(e.source)) i.push(e.source);
  }
  return { nodes, outs, ins };
}

export const clientsOf = (d: Design) => d.nodes.filter((n) => n.type === 'client');
