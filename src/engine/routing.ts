import { isCacheLike } from './components';
import type { Graph } from './graph';
import type { Op } from './types';

/**
 * Routing rules, shared by the discrete-event simulator and the analytic flow model so the
 * two always agree. Given a request that just finished at `nodeId`, which nodes may it go to
 * next? The caller picks one candidate (uniformly at random in the simulator, evenly split in
 * the analytic model). An empty list means the request is complete.
 *
 *  - Writes prefer a Message Queue if one is attached (async hand-off), else skip caches/CDNs
 *    (unless a cache is the only path, i.e. an in-line cache — writes then pass through it).
 *  - Reads prefer a Cache/CDN if one is attached. Reads never go to queues or workers.
 *  - A cache with no outgoing edges is a "side cache": on a miss the request falls back to the
 *    caller's (`prevId`) non-cache targets — the classic cache-aside pattern.
 *  - A Message Queue's targets are its consumers (workers); the queue drains to them.
 */
export function nextTargets(g: Graph, nodeId: string, op: Op, prevId: string | null): string[] {
  const node = g.nodes.get(nodeId);
  if (!node) return [];
  const outs = g.outs.get(nodeId) ?? [];
  if (node.type === 'queue') return outs;
  if (isCacheLike(node.type) && outs.length === 0 && prevId) {
    const fallback = (g.outs.get(prevId) ?? []).filter((id) => !isCacheLike(typeOf(g, id)));
    return selectTargets(g, fallback, op);
  }
  return selectTargets(g, outs, op);
}

function selectTargets(g: Graph, outs: string[], op: Op): string[] {
  if (op === 'write') {
    const queues = outs.filter((id) => typeOf(g, id) === 'queue');
    if (queues.length) return queues;
    const nonCache = outs.filter((id) => !isCacheLike(typeOf(g, id)));
    return nonCache.length ? nonCache : outs;
  }
  const caches = outs.filter((id) => isCacheLike(typeOf(g, id)));
  if (caches.length) return caches;
  return outs.filter((id) => {
    const t = typeOf(g, id);
    return t !== 'queue' && t !== 'worker';
  });
}

const typeOf = (g: Graph, id: string) => g.nodes.get(id)!.type;
