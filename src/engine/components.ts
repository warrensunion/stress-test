import type { ComponentType, NodeParams } from './types';

/** Which type-specific params a component exposes. Drives the inspector UI and validation. */
export type ExtraParam = 'hitRate' | 'replicas' | 'consumerRate';

export interface ComponentSpec {
  type: ComponentType;
  label: string;
  description: string;
  defaults: NodeParams;
  extraParams: ExtraParam[];
  /** Whether capacity/latency/instances are meaningful (false for the traffic source). */
  hasCapacity: boolean;
}

/**
 * Catalog of component types. To add a new type: add it to `ComponentType` in types.ts,
 * add an entry here, and (if it routes requests differently) teach `routing.ts` about it.
 */
export const COMPONENT_SPECS: Record<ComponentType, ComponentSpec> = {
  client: {
    type: 'client',
    label: 'Client',
    description: 'Traffic source. Generates the workload defined in the design.',
    defaults: { capacity: 1e9, latencyMs: 0, instances: 1 },
    extraParams: [],
    hasCapacity: false,
  },
  loadBalancer: {
    type: 'loadBalancer',
    label: 'Load Balancer',
    description: 'Spreads traffic across healthy downstream nodes (health-checked).',
    defaults: { capacity: 50000, latencyMs: 1, instances: 1 },
    extraParams: [],
    hasCapacity: true,
  },
  appServer: {
    type: 'appServer',
    label: 'App Server',
    description: 'Stateless application tier.',
    defaults: { capacity: 1000, latencyMs: 10, instances: 2 },
    extraParams: [],
    hasCapacity: true,
  },
  cache: {
    type: 'cache',
    label: 'Cache',
    description: 'In-memory cache (e.g. Redis). Read hits return immediately.',
    defaults: { capacity: 20000, latencyMs: 1, instances: 1, hitRate: 0.8 },
    extraParams: ['hitRate'],
    hasCapacity: true,
  },
  sqlDb: {
    type: 'sqlDb',
    label: 'SQL Database',
    description: 'Relational DB. Writes go to the primary; reads can use read replicas.',
    defaults: { capacity: 1500, latencyMs: 5, instances: 1, replicas: 0 },
    extraParams: ['replicas'],
    hasCapacity: true,
  },
  queue: {
    type: 'queue',
    label: 'Message Queue',
    description: 'Async buffer. Producers get an ack on enqueue; workers drain at consumer rate.',
    defaults: { capacity: 20000, latencyMs: 2, instances: 1, consumerRate: 2000 },
    extraParams: ['consumerRate'],
    hasCapacity: true,
  },
  worker: {
    type: 'worker',
    label: 'Worker',
    description: 'Background consumer that processes queued messages.',
    defaults: { capacity: 500, latencyMs: 20, instances: 2 },
    extraParams: [],
    hasCapacity: true,
  },
  cdn: {
    type: 'cdn',
    label: 'CDN',
    description: 'Edge cache for static/large objects. Read hits are served at the edge.',
    defaults: { capacity: 100000, latencyMs: 15, instances: 1, hitRate: 0.9 },
    extraParams: ['hitRate'],
    hasCapacity: true,
  },
};

export const isCacheLike = (t: ComponentType) => t === 'cache' || t === 'cdn';
