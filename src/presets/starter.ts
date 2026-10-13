import { parseDesign } from '../engine/schema';

export const starterDesign = () =>
  parseDesign({
    name: 'Starter: 3-tier web app',
    workload: { rps: 2000, readRatio: 0.9, objectSizeKb: 5 },
    nodes: [
      { id: 'client', type: 'client', label: 'Users', position: { x: 0, y: 100 } },
      { id: 'lb', type: 'loadBalancer', label: 'Load Balancer', position: { x: 220, y: 100 } },
      { id: 'app', type: 'appServer', label: 'API', position: { x: 440, y: 100 }, params: { instances: 3 } },
      { id: 'db', type: 'sqlDb', label: 'Postgres', position: { x: 680, y: 100 }, params: { replicas: 1 } },
    ],
    edges: [
      { source: 'client', target: 'lb' },
      { source: 'lb', target: 'app' },
      { source: 'app', target: 'db' },
    ],
  });
