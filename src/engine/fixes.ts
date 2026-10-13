import { addEdge, addNode, removeEdges, updateNode } from './designOps';
import type { FlowResult } from './flow';
import { buildGraph } from './graph';
import type { Design, NodeParams } from './types';

// Machine-applicable design changes. Lint rules and the advice engine attach these so the UI
// can offer one-click "apply". Every fix is a pure Design → Design transform.

export type Fix =
  | { kind: 'setParam'; nodeId: string; param: keyof NodeParams; value: number }
  | { kind: 'addSideCache'; callerId: string; dbId: string }
  | { kind: 'addLoadBalancer'; upstreamId: string; targetIds: string[] }
  | { kind: 'addWorker'; queueId: string }
  | { kind: 'batch'; fixes: Fix[] };

const PARAM_LABEL: Partial<Record<keyof NodeParams, string>> = {
  instances: 'instances',
  replicas: 'read replicas',
  consumerRate: 'consumer rate',
  capacity: 'capacity per instance',
  hitRate: 'hit rate',
};

export function describeFix(d: Design, f: Fix): string {
  const label = (id: string) => d.nodes.find((n) => n.id === id)?.label ?? id;
  switch (f.kind) {
    case 'setParam': {
      const node = d.nodes.find((n) => n.id === f.nodeId);
      const from = node?.params[f.param];
      return `Set ${label(f.nodeId)} ${PARAM_LABEL[f.param] ?? f.param}: ${from ?? '—'} → ${f.value}`;
    }
    case 'addSideCache':
      return `Add a cache beside ${label(f.dbId)} (cache-aside from ${label(f.callerId)})`;
    case 'addLoadBalancer':
      return `Put a load balancer between ${label(f.upstreamId)} and ${f.targetIds.map(label).join(', ')}`;
    case 'addWorker':
      return `Add workers consuming from ${label(f.queueId)}`;
    case 'batch':
      return f.fixes.map((x) => describeFix(d, x)).join('; ');
  }
}

export function applyFix(d: Design, f: Fix): Design {
  switch (f.kind) {
    case 'batch':
      return f.fixes.reduce(applyFix, d);
    case 'setParam':
      return updateNode(d, f.nodeId, { params: { [f.param]: f.value } });
    case 'addSideCache': {
      const db = d.nodes.find((n) => n.id === f.dbId);
      const caller = d.nodes.find((n) => n.id === f.callerId);
      if (!db || !caller) return d;
      const [withCache, cacheId] = addNode(d, 'cache', { x: (caller.position.x + db.position.x) / 2, y: db.position.y - 140 }, 'Cache');
      return addEdge(withCache, f.callerId, cacheId);
    }
    case 'addLoadBalancer': {
      const up = d.nodes.find((n) => n.id === f.upstreamId);
      if (!up) return d;
      const targets = d.nodes.filter((n) => f.targetIds.includes(n.id));
      const avgY = targets.reduce((s, n) => s + n.position.y, 0) / Math.max(1, targets.length);
      const x = targets.length ? (up.position.x + Math.min(...targets.map((n) => n.position.x))) / 2 : up.position.x + 150;
      const [withLb, lbId] = addNode(d, 'loadBalancer', { x, y: avgY + 90 }, 'Load Balancer');
      let next = removeEdges(
        withLb,
        withLb.edges.filter((e) => e.source === f.upstreamId && f.targetIds.includes(e.target)).map((e) => e.id),
      );
      next = addEdge(next, f.upstreamId, lbId);
      for (const t of f.targetIds) next = addEdge(next, lbId, t);
      return next;
    }
    case 'addWorker': {
      const q = d.nodes.find((n) => n.id === f.queueId);
      if (!q) return d;
      const [next, wId] = addNode(d, 'worker', { x: q.position.x + 220, y: q.position.y }, 'Workers');
      return addEdge(next, f.queueId, wId);
    }
  }
}

/**
 * The scaling change that brings `nodeId` to roughly `targetUtil` at the analysed load.
 * Returns null when scaling this node's knobs can't help (e.g. clients).
 */
export function scaleFixFor(d: Design, flows: FlowResult, nodeId: string, targetUtil = 0.7): Fix | null {
  const node = d.nodes.find((n) => n.id === nodeId);
  const f = flows.nodes[nodeId];
  if (!node || !f || node.type === 'client') return null;
  const { capacity, instances } = node.params;
  if (node.type === 'sqlDb') {
    const replicas = node.params.replicas ?? 0;
    const writeUtil = f.writeRate / (instances * capacity);
    if (writeUtil > targetUtil) {
      // Replicas can't absorb writes: scale the primary up (bigger box).
      return { kind: 'setParam', nodeId, param: 'capacity', value: roundUp(f.writeRate / (instances * targetUtil)) };
    }
    const needed = Math.max(replicas + 1, Math.ceil(f.rate / (capacity * targetUtil)) - instances);
    return { kind: 'setParam', nodeId, param: 'replicas', value: needed };
  }
  if (node.type === 'queue') {
    const g = buildGraph(d);
    const consumers = g.outs.get(nodeId) ?? [];
    if (!consumers.length) return { kind: 'addWorker', queueId: nodeId };
    const consumerCap = consumers.reduce((s, id) => s + g.nodes.get(id)!.params.capacity * g.nodes.get(id)!.params.instances, 0);
    const wantDrain = f.rate / targetUtil;
    const fixes: Fix[] = [];
    if (consumerCap < wantDrain) {
      // Workers are a limit; scale the first consumer.
      const w = g.nodes.get(consumers[0])!;
      const otherCap = consumerCap - w.params.capacity * w.params.instances;
      fixes.push({
        kind: 'setParam',
        nodeId: w.id,
        param: 'instances',
        value: Math.max(w.params.instances + 1, Math.ceil((wantDrain - otherCap) / w.params.capacity)),
      });
    }
    if ((node.params.consumerRate ?? 0) < wantDrain) {
      fixes.push({ kind: 'setParam', nodeId, param: 'consumerRate', value: roundUp(wantDrain) });
    }
    if (fixes.length) return fixes.length === 1 ? fixes[0] : { kind: 'batch', fixes };
    // Otherwise ingest is the limit: fall through to scaling queue instances.
  }
  return { kind: 'setParam', nodeId, param: 'instances', value: Math.max(instances + 1, Math.ceil(f.rate / (capacity * targetUtil))) };
}

/** Round up to 2 significant figures (e.g. 1234 → 1300). */
function roundUp(x: number) {
  if (x <= 0) return 0;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return Math.ceil(x / mag) * mag;
}
