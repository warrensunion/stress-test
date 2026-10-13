import { isCacheLike } from '../components';
import { fmt } from '../estimator';
import { scaleFixFor } from '../fixes';
import type { DesignNode } from '../types';
import type { LintContext, LintRule, RuleHit } from './types';

// The rule catalog. To add a rule: append an object implementing LintRule. `check` gets the
// design, its graph and the analytic flows, and returns zero or more hits.

const label = (ctx: LintContext, id: string) => ctx.graph.nodes.get(id)?.label ?? id;
const ofType = (ctx: LintContext, t: DesignNode['type']) => ctx.design.nodes.filter((n) => n.type === t);
const ins = (ctx: LintContext, id: string) => (ctx.graph.ins.get(id) ?? []).map((i) => ctx.graph.nodes.get(i)!);
const outs = (ctx: LintContext, id: string) => (ctx.graph.outs.get(id) ?? []).map((i) => ctx.graph.nodes.get(i)!);

function reachableFromClients(ctx: LintContext): Set<string> {
  const seen = new Set<string>();
  const stack = ofType(ctx, 'client').map((c) => c.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(ctx.graph.outs.get(id) ?? []));
  }
  return seen;
}

/** Longest synchronous path (in nodes, excluding the client) starting from any client; stops at queues. */
function longestSyncChain(ctx: LintContext): string[] {
  let best: string[] = [];
  const dfs = (id: string, path: string[], onPath: Set<string>) => {
    const node = ctx.graph.nodes.get(id)!;
    const here = node.type === 'client' ? path : [...path, id];
    if (here.length > best.length) best = here;
    if (node.type === 'queue') return; // async boundary
    for (const next of ctx.graph.outs.get(id) ?? []) {
      if (onPath.has(next)) continue;
      onPath.add(next);
      dfs(next, here, onPath);
      onPath.delete(next);
    }
  };
  for (const c of ofType(ctx, 'client')) dfs(c.id, [], new Set([c.id]));
  return best;
}

function findCycle(ctx: LintContext): string[] | null {
  const state = new Map<string, 1 | 2>(); // 1 = on the DFS stack, 2 = finished
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const n of ctx.graph.outs.get(id) ?? []) {
      if (state.get(n) === 1) return stack.slice(stack.indexOf(n));
      if (!state.has(n)) {
        const c = visit(n);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const n of ctx.design.nodes) {
    if (state.has(n.id)) continue;
    const c = visit(n.id);
    if (c) return c;
  }
  return null;
}

export const RULES: LintRule[] = [
  {
    id: 'no-client',
    severity: 'error',
    title: 'No traffic source',
    why: 'Without a Client node nothing generates load, so the design cannot be simulated or evaluated.',
    check: (ctx) =>
      ctx.design.nodes.length && !ofType(ctx, 'client').length
        ? [{ nodeIds: [], message: 'The design has no Client node.', fix: 'Add a Client and connect it to your entry point (CDN or load balancer).' }]
        : [],
  },
  {
    id: 'cycle',
    severity: 'error',
    title: 'Request cycle',
    why: 'A cycle means a request can loop forever between services, amplifying load until something falls over. Real systems need a clear direction of calls.',
    check: (ctx) => {
      const c = findCycle(ctx);
      return c
        ? [{ nodeIds: c, message: `Requests can loop: ${c.map((id) => label(ctx, id)).join(' → ')}.`, fix: 'Remove the back-edge so calls flow one way (use a queue for callbacks).' }]
        : [];
    },
  },
  {
    id: 'orphan-node',
    severity: 'info',
    title: 'Unreachable component',
    why: 'A component no client traffic can reach adds cost and complexity but carries no load — usually a missing edge.',
    check: (ctx) => {
      if (!ofType(ctx, 'client').length) return [];
      const reach = reachableFromClients(ctx);
      return ctx.design.nodes
        .filter((n) => !reach.has(n.id))
        .map((n) => ({ nodeIds: [n.id], message: `${n.label} is not reachable from any client.`, fix: 'Connect it to the request path or remove it.' }));
    },
  },
  {
    id: 'client-direct-db',
    severity: 'error',
    title: 'Client talks directly to the database',
    why: 'Exposing the database to clients bypasses authorization and validation, and every client holds a DB connection — databases support far fewer connections than app servers.',
    check: (ctx) =>
      ctx.design.edges
        .filter((e) => ctx.graph.nodes.get(e.source)?.type === 'client' && ctx.graph.nodes.get(e.target)?.type === 'sqlDb')
        .map((e) => ({
          nodeIds: [e.source, e.target],
          message: `${label(ctx, e.source)} connects straight to ${label(ctx, e.target)}.`,
          fix: 'Route clients through a load balancer and app servers.',
        })),
  },
  {
    id: 'db-single-point-of-failure',
    severity: 'warning',
    title: 'Database is a single point of failure',
    why: 'With one database instance and no replicas, a single machine failure or maintenance window takes the whole product down, and all reads compete with writes.',
    check: (ctx) =>
      ofType(ctx, 'sqlDb')
        .filter((n) => n.params.instances === 1 && (n.params.replicas ?? 0) === 0)
        .map((n) => ({
          nodeIds: [n.id],
          message: `${n.label} has no read replica.`,
          fix: 'Add at least one read replica (also gives you a failover target).',
          autoFix: { kind: 'setParam', nodeId: n.id, param: 'replicas', value: 1 },
        })),
  },
  {
    id: 'single-app-instance',
    severity: 'warning',
    title: 'Single app server instance',
    why: 'One instance means any crash, deploy or bad host is a full outage, and there is no headroom for traffic spikes.',
    check: (ctx) =>
      ofType(ctx, 'appServer')
        .filter((n) => n.params.instances === 1)
        .filter((n) => {
          // OK if it's one of several app servers behind a shared load balancer.
          const lbs = ins(ctx, n.id).filter((u) => u.type === 'loadBalancer');
          return !lbs.some((lb) => outs(ctx, lb.id).filter((o) => o.type === 'appServer').length > 1);
        })
        .map((n) => ({
          nodeIds: [n.id],
          message: `${n.label} runs a single instance.`,
          fix: 'Run at least 2 instances behind a load balancer.',
          autoFix: { kind: 'setParam', nodeId: n.id, param: 'instances', value: 2 },
        })),
  },
  {
    id: 'multiple-app-no-lb',
    severity: 'warning',
    title: 'Multiple app servers without a load balancer',
    why: 'Without a load balancer, clients must pick servers themselves: traffic spreads unevenly and dead instances keep receiving requests because nothing health-checks them.',
    check: (ctx) => {
      const hits: RuleHit[] = [];
      for (const up of ctx.design.nodes.filter((n) => n.type === 'client' || n.type === 'cdn')) {
        const apps = outs(ctx, up.id).filter((o) => o.type === 'appServer');
        const needsLb = apps.length > 1 || apps.some((a) => a.params.instances > 1);
        if (needsLb) {
          hits.push({
            nodeIds: [up.id, ...apps.map((a) => a.id)],
            message: `${up.label} sends traffic straight to ${apps.map((a) => a.label).join(', ')} (${apps.reduce((s, a) => s + a.params.instances, 0)} instances).`,
            fix: 'Insert a load balancer with health checks.',
            autoFix: { kind: 'addLoadBalancer', upstreamId: up.id, targetIds: apps.map((a) => a.id) },
          });
        }
      }
      return hits;
    },
  },
  {
    id: 'read-heavy-no-cache',
    severity: 'warning',
    title: 'Read-heavy workload with no cache',
    why: 'When most traffic is reads, a cache absorbs repeated lookups in ~1 ms and cuts database load roughly by the hit rate — usually the cheapest capacity you can buy.',
    check: (ctx) => {
      if (ctx.design.workload.readRatio < 0.7) return [];
      return ofType(ctx, 'sqlDb')
        .filter((db) => (ctx.flows.nodes[db.id]?.readRate ?? 0) > 0)
        .filter((db) => {
          const callers = ins(ctx, db.id);
          const behindCache = callers.some((c) => isCacheLike(c.type));
          const sideCache = callers.some((c) => outs(ctx, c.id).some((o) => o.type === 'cache'));
          return !behindCache && !sideCache;
        })
        .map((db) => {
          const caller = ins(ctx, db.id).find((c) => c.type === 'appServer' || c.type === 'worker') ?? ins(ctx, db.id)[0];
          return {
            nodeIds: [db.id],
            message: `${Math.round(ctx.design.workload.readRatio * 100)}% of traffic is reads, and every read reaches ${db.label} (${fmt(ctx.flows.nodes[db.id].readRate)} reads/s).`,
            fix: 'Add a cache (cache-aside) in front of the database.',
            autoFix: caller ? { kind: 'addSideCache', callerId: caller.id, dbId: db.id } : undefined,
          };
        });
    },
  },
  {
    id: 'deep-sync-chain',
    severity: 'warning',
    title: 'Deep synchronous call chain',
    why: 'Each synchronous hop adds latency and multiplies failure probability: five services at 99.9% each give ~99.5% end to end, and one slow hop stalls the whole request.',
    check: (ctx) => {
      const chain = longestSyncChain(ctx);
      return chain.length > 4
        ? [{
            nodeIds: chain,
            message: `A request passes through ${chain.length} synchronous hops: ${chain.map((id) => label(ctx, id)).join(' → ')}.`,
            fix: 'Collapse services, cache intermediate results, or move non-critical work behind a queue.',
          }]
        : [];
    },
  },
  {
    id: 'queue-no-consumers',
    severity: 'error',
    title: 'Queue with no workers',
    why: 'Messages pile up forever: the backlog grows without bound, memory or disk fills, and the work producers think is done never happens.',
    check: (ctx) =>
      ofType(ctx, 'queue')
        .filter((q) => !(ctx.graph.outs.get(q.id) ?? []).length)
        .map((q) => ({
          nodeIds: [q.id],
          message: `${q.label} has no consumers.`,
          fix: 'Attach workers that consume from the queue.',
          autoFix: { kind: 'addWorker', queueId: q.id },
        })),
  },
  {
    id: 'queue-backlog-growth',
    severity: 'error',
    title: 'Queue drains slower than it fills',
    why: 'If messages arrive faster than consumers process them, the backlog — and the delay before work happens — grows without limit.',
    check: (ctx) =>
      ofType(ctx, 'queue')
        .filter((q) => (ctx.graph.outs.get(q.id) ?? []).length && (ctx.flows.nodes[q.id]?.utilization ?? 0) >= 1)
        .map((q) => ({
          nodeIds: [q.id, ...(ctx.graph.outs.get(q.id) ?? [])],
          message: `${q.label} receives ${fmt(ctx.flows.nodes[q.id].rate)} msg/s but can drain only ${fmt(ctx.flows.nodes[q.id].rate / ctx.flows.nodes[q.id].utilization)} msg/s.`,
          fix: 'Raise the consumer rate or add worker instances.',
          autoFix: scaleFixFor(ctx.design, ctx.flows, q.id) ?? undefined,
        })),
  },
  {
    id: 'cache-on-write-path',
    severity: 'warning',
    title: 'Cache in front of a write-heavy path',
    why: 'Writes pass through (and invalidate) the cache without benefiting from it: you pay extra latency and load on every write while hit rates collapse.',
    check: (ctx) =>
      ctx.design.nodes
        .filter((n) => n.type === 'cache')
        .filter((n) => {
          const f = ctx.flows.nodes[n.id];
          return f && f.writeRate > 0 && f.writeRate >= f.readRate;
        })
        .map((n) => ({
          nodeIds: [n.id],
          message: `${n.label} sees ${fmt(ctx.flows.nodes[n.id].writeRate)} writes/s vs ${fmt(ctx.flows.nodes[n.id].readRate)} reads/s.`,
          fix: 'Use cache-aside for reads only (connect the cache beside the DB, not in-line), or drop the cache from this path.',
        })),
  },
  {
    id: 'cdn-missing-large-objects',
    severity: 'warning',
    title: 'Large objects served without a CDN',
    why: 'Large, read-mostly objects dominate bandwidth. Serving them from origin costs egress and puts distance latency on every request; a CDN serves them from the edge.',
    check: (ctx) => {
      const w = ctx.design.workload;
      if (w.objectSizeKb < 100 || w.readRatio < 0.5 || ofType(ctx, 'cdn').length || !ofType(ctx, 'client').length) return [];
      const egressMBs = (w.rps * w.readRatio * w.objectSizeKb) / 1024;
      return [{
        nodeIds: ofType(ctx, 'client').map((c) => c.id),
        message: `Objects average ${fmt(w.objectSizeKb)} KB — about ${fmt(egressMBs)} MB/s of read egress from origin.`,
        fix: 'Put a CDN between clients and the origin for static/large content.',
      }];
    },
  },
  {
    id: 'capacity-exceeded',
    severity: 'error',
    title: 'Over capacity at the configured load',
    why: 'A component asked to do more than 100% of its capacity builds an ever-growing queue: latency climbs until requests time out or are dropped.',
    check: (ctx) =>
      Object.values(ctx.flows.nodes)
        .filter((f) => f.utilization >= 1 && ctx.graph.nodes.get(f.nodeId)!.type !== 'queue')
        .map((f) => ({
          nodeIds: [f.nodeId],
          message: `${label(ctx, f.nodeId)} needs ${fmt(f.utilization * 100)}% of its capacity at ${fmt(ctx.flows.rps)} req/s (saturates at ${fmt(f.saturationRps)} req/s).`,
          fix: 'Scale this component out (or up) before it sees this load.',
          autoFix: scaleFixFor(ctx.design, ctx.flows, f.nodeId) ?? undefined,
        })),
  },
  {
    id: 'high-utilization',
    severity: 'warning',
    title: 'Running hot',
    why: 'Queueing delay grows sharply above ~80% utilization (M/M/1 wait ∝ ρ/(1−ρ)): at 90% the wait is 9× the service time, and small spikes cause big latency jumps.',
    check: (ctx) =>
      Object.values(ctx.flows.nodes)
        .filter((f) => f.utilization >= 0.8 && f.utilization < 1)
        .map((f) => ({
          nodeIds: [f.nodeId],
          message: `${label(ctx, f.nodeId)} is ${Math.round(f.utilization * 100)}% utilized at the configured load.`,
          fix: 'Add headroom: target ≤ 70% at peak.',
          autoFix: scaleFixFor(ctx.design, ctx.flows, f.nodeId) ?? undefined,
        })),
  },
  {
    id: 'low-cache-hit-rate',
    severity: 'info',
    title: 'Low cache hit rate',
    why: 'Below ~50% hits, a cache adds a network hop to most requests while removing little load. Check key design, TTLs and cache size.',
    check: (ctx) =>
      ctx.design.nodes
        .filter((n) => isCacheLike(n.type) && (n.params.hitRate ?? 0) < 0.5)
        .map((n) => ({
          nodeIds: [n.id],
          message: `${n.label} hit rate is ${Math.round((n.params.hitRate ?? 0) * 100)}%.`,
          fix: 'Size the cache to the hot set (see Estimator) or cache at a coarser granularity.',
        })),
  },
  {
    id: 'single-load-balancer',
    severity: 'info',
    title: 'Single load balancer instance',
    why: 'The load balancer is in front of everything: if its single instance fails, the whole service is unreachable.',
    check: (ctx) =>
      ofType(ctx, 'loadBalancer')
        .filter((n) => n.params.instances === 1)
        .map((n) => ({
          nodeIds: [n.id],
          message: `${n.label} has one instance.`,
          fix: 'Run an active/passive pair (or use a managed LB).',
          autoFix: { kind: 'setParam', nodeId: n.id, param: 'instances', value: 2 },
        })),
  },
];
