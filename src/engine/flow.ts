import { isCacheLike } from './components';
import { buildGraph, clientsOf, type Graph } from './graph';
import { nextTargets } from './routing';
import type { Design, DesignNode, Op } from './types';

// Analytic (expected-value) traffic model. Propagates average request rates through the same
// routing rules the simulator uses. Because every routing split is linear in load, utilization
// is proportional to rps, which gives an instant estimate of each node's saturation point.

export interface NodeFlow {
  nodeId: string;
  readRate: number;
  writeRate: number;
  /** Arrivals per second (reads + writes). */
  rate: number;
  /** Fraction of capacity used (can exceed 1 = overloaded; Infinity = nothing can drain it). */
  utilization: number;
  /** Client rps at which this node hits 100% utilization. */
  saturationRps: number;
}

export interface FlowResult {
  rps: number;
  nodes: Record<string, NodeFlow>;
  /** Node that saturates first, if any carries load. */
  bottleneck: NodeFlow | null;
}

const MAX_DEPTH = 64;

export function computeFlows(design: Design, rps = design.workload.rps): FlowResult {
  const g = buildGraph(design);
  const reads = new Map<string, number>();
  const writes = new Map<string, number>();
  const asyncIn = new Map<string, number>(); // arrivals into a queue's backlog
  for (const n of design.nodes) {
    reads.set(n.id, 0);
    writes.set(n.id, 0);
  }

  const clients = clientsOf(design);
  const perClient = clients.length ? rps / clients.length : 0;
  const r = design.workload.readRatio;

  const forward = (from: string, op: Op, rate: number, prev: string | null, depth: number) => {
    const targets = nextTargets(g, from, op, prev);
    for (const t of targets) arrive(t, op, rate / targets.length, from, depth + 1);
  };

  const arrive = (id: string, op: Op, rate: number, prev: string, depth: number) => {
    if (rate <= 0 || depth > MAX_DEPTH) return;
    const node = g.nodes.get(id)!;
    (op === 'read' ? reads : writes).set(id, (op === 'read' ? reads : writes).get(id)! + rate);
    if (node.type === 'queue') {
      asyncIn.set(id, (asyncIn.get(id) ?? 0) + rate);
      return; // drained separately below (rate-limited by consumers)
    }
    let out = rate;
    if (isCacheLike(node.type) && op === 'read') out = rate * (1 - (node.params.hitRate ?? 0));
    forward(id, op, out, prev, depth);
  };

  for (const c of clients) {
    forward(c.id, 'read', perClient * r, null, 0);
    forward(c.id, 'write', perClient * (1 - r), null, 0);
  }
  // Queue drains: in steady state consumers receive min(arrivals, drain capacity). Queues feeding
  // queues are handled by iterating a few times.
  for (let pass = 0; pass < 4; pass++) {
    const snapshot = [...asyncIn.entries()];
    asyncIn.clear();
    for (const [qid, rate] of snapshot) {
      const drain = Math.min(rate, drainCapacity(g, g.nodes.get(qid)!));
      const targets = g.outs.get(qid) ?? [];
      // Messages are treated as writes (async work is almost always a mutation).
      for (const t of targets) arrive(t, 'write', drain / targets.length, qid, 1);
    }
    if (asyncIn.size === 0) break;
  }

  const nodes: Record<string, NodeFlow> = {};
  let bottleneck: NodeFlow | null = null;
  for (const n of design.nodes) {
    if (n.type === 'client') continue;
    const rr = reads.get(n.id)!;
    const ww = writes.get(n.id)!;
    const utilization = nodeUtilization(g, n, rr, ww);
    const nf: NodeFlow = {
      nodeId: n.id,
      readRate: rr,
      writeRate: ww,
      rate: rr + ww,
      utilization,
      saturationRps: utilization > 0 ? rps / utilization : Infinity,
    };
    nodes[n.id] = nf;
    // Undrained queues (∞) are flagged by the linter; they never limit synchronous throughput.
    if (nf.rate > 0 && Number.isFinite(nf.utilization) && (!bottleneck || nf.utilization > bottleneck.utilization)) bottleneck = nf;
  }
  return { rps, nodes, bottleneck };
}

/** Max messages/s a queue can hand to its consumers: min(consumerRate, total consumer capacity). */
export function drainCapacity(g: Graph, q: DesignNode): number {
  const consumers = (g.outs.get(q.id) ?? []).map((id) => g.nodes.get(id)!);
  if (!consumers.length) return 0;
  const consumerCap = consumers.reduce((s, c) => s + c.params.capacity * c.params.instances, 0);
  return Math.min(q.params.consumerRate ?? Infinity, consumerCap);
}

function nodeUtilization(g: Graph, n: DesignNode, reads: number, writes: number): number {
  const { capacity, instances } = n.params;
  const total = reads + writes;
  if (n.type === 'sqlDb') {
    // Writes must hit primaries; reads balance across primaries + replicas.
    const replicas = n.params.replicas ?? 0;
    const perServerIfBalanced = total / (instances + replicas);
    const primaryWriteLoad = writes / instances;
    return Math.max(perServerIfBalanced, primaryWriteLoad) / capacity;
  }
  const ingest = total / (capacity * instances);
  if (n.type === 'queue') {
    const drainCap = drainCapacity(g, n);
    const drainUtil = total === 0 ? 0 : drainCap > 0 ? total / drainCap : Infinity;
    return Math.max(ingest, drainUtil);
  }
  return ingest;
}
