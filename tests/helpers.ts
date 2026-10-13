import { parseDesign } from '../src/engine/schema';
import type { ComponentType, Design, NodeParams } from '../src/engine/types';

type N = [id: string, type: ComponentType, params?: Partial<NodeParams>];

/** Compact design builder for tests. Edges are chains like 'a>b>c'. */
export function mk(nodes: N[], edges: string[], workload: Partial<Design['workload']> = {}): Design {
  return parseDesign({
    name: 'test',
    nodes: nodes.map(([id, type, params]) => ({ id, type, params: params ?? {} })),
    edges: edges.flatMap((chain) => {
      const ids = chain.split('>');
      return ids.slice(1).map((t, i) => ({ source: ids[i], target: t }));
    }),
    workload: { rps: 1000, readRatio: 0.9, objectSizeKb: 1, ...workload },
  });
}

/** Single M/M/1 server behind a client, zero fixed latency. */
export const mm1 = (lambda: number, mu: number, maxQueue?: number) =>
  mk([['c', 'client'], ['s', 'appServer', { capacity: mu, instances: 1, latencyMs: 0, maxQueue }]], ['c>s'], {
    rps: lambda,
  });
