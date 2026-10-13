import { COMPONENT_SPECS } from './components';
import { COMPONENT_TYPES, type ComponentType, type Design, type DesignEdge, type DesignNode } from './types';

export class DesignParseError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Validate + normalize untrusted JSON into a Design. Missing params get component defaults,
 * so hand-written or older JSON still loads. Throws DesignParseError on structural problems.
 */
export function parseDesign(input: unknown): Design {
  if (!isObj(input)) throw new DesignParseError('Design must be a JSON object');
  if (!Array.isArray(input.nodes)) throw new DesignParseError('Design.nodes must be an array');
  if (!Array.isArray(input.edges)) throw new DesignParseError('Design.edges must be an array');

  const ids = new Set<string>();
  const nodes: DesignNode[] = input.nodes.map((raw, i) => {
    if (!isObj(raw)) throw new DesignParseError(`nodes[${i}] must be an object`);
    if (typeof raw.id !== 'string' || !raw.id) throw new DesignParseError(`nodes[${i}].id must be a non-empty string`);
    if (ids.has(raw.id)) throw new DesignParseError(`Duplicate node id "${raw.id}"`);
    ids.add(raw.id);
    if (!COMPONENT_TYPES.includes(raw.type as ComponentType)) {
      throw new DesignParseError(`nodes[${i}].type "${String(raw.type)}" is not a known component type`);
    }
    const type = raw.type as ComponentType;
    const spec = COMPONENT_SPECS[type];
    const p = isObj(raw.params) ? raw.params : {};
    const pos = isObj(raw.position) ? raw.position : {};
    const params: DesignNode['params'] = {
      capacity: Math.max(0.001, num(p.capacity, spec.defaults.capacity)),
      latencyMs: Math.max(0, num(p.latencyMs, spec.defaults.latencyMs)),
      instances: Math.max(1, Math.round(num(p.instances, spec.defaults.instances))),
    };
    if (spec.extraParams.includes('hitRate')) params.hitRate = clamp01(num(p.hitRate, spec.defaults.hitRate ?? 0));
    if (spec.extraParams.includes('replicas')) params.replicas = Math.max(0, Math.round(num(p.replicas, spec.defaults.replicas ?? 0)));
    if (spec.extraParams.includes('consumerRate')) params.consumerRate = Math.max(0, num(p.consumerRate, spec.defaults.consumerRate ?? 0));
    if (typeof p.maxQueue === 'number' && p.maxQueue > 0) params.maxQueue = p.maxQueue;
    return {
      id: raw.id,
      type,
      label: typeof raw.label === 'string' ? raw.label : spec.label,
      position: { x: num(pos.x, 0), y: num(pos.y, 0) },
      params,
    };
  });

  const edgeIds = new Set<string>();
  const edges: DesignEdge[] = input.edges.map((raw, i) => {
    if (!isObj(raw)) throw new DesignParseError(`edges[${i}] must be an object`);
    const { source, target } = raw;
    if (typeof source !== 'string' || !ids.has(source)) throw new DesignParseError(`edges[${i}].source references unknown node`);
    if (typeof target !== 'string' || !ids.has(target)) throw new DesignParseError(`edges[${i}].target references unknown node`);
    let id = typeof raw.id === 'string' && raw.id ? raw.id : `e-${source}-${target}`;
    while (edgeIds.has(id)) id += '_';
    edgeIds.add(id);
    return { id, source, target };
  });

  const w = isObj(input.workload) ? input.workload : {};
  return {
    version: 1,
    name: typeof input.name === 'string' ? input.name : 'Untitled design',
    nodes,
    edges,
    workload: {
      rps: Math.max(0, num(w.rps, 1000)),
      readRatio: clamp01(num(w.readRatio, 0.9)),
      objectSizeKb: Math.max(0, num(w.objectSizeKb, 10)),
    },
  };
}

export const serializeDesign = (d: Design): string => JSON.stringify(d, null, 2);

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function emptyDesign(name = 'Untitled design'): Design {
  return { version: 1, name, nodes: [], edges: [], workload: { rps: 1000, readRatio: 0.9, objectSizeKb: 10 } };
}

let idCounter = 0;
export function newId(prefix: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  let id: string;
  do id = `${prefix}-${++idCounter}`;
  while (taken.has(id));
  return id;
}
