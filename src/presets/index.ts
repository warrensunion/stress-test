import { parseDesign } from '../engine/schema';
import type { Design } from '../engine/types';
import { starterDesign } from './starter';

export interface Preset {
  id: string;
  name: string;
  description: string;
  build: () => Design;
}

const chain = (...ids: string[]) => ids.slice(1).map((t, i) => ({ source: ids[i], target: t }));

const urlShortener = () =>
  parseDesign({
    name: 'URL shortener',
    workload: { rps: 8000, readRatio: 0.99, objectSizeKb: 0.5 },
    nodes: [
      { id: 'users', type: 'client', label: 'Users', position: { x: 0, y: 120 } },
      { id: 'lb', type: 'loadBalancer', label: 'Load Balancer', position: { x: 220, y: 120 }, params: { instances: 2 } },
      { id: 'api', type: 'appServer', label: 'Redirect API', position: { x: 440, y: 120 }, params: { capacity: 2000, instances: 6, latencyMs: 3 } },
      { id: 'redis', type: 'cache', label: 'Redis (hot links)', position: { x: 680, y: 0 }, params: { hitRate: 0.95, capacity: 50000 } },
      { id: 'db', type: 'sqlDb', label: 'Links DB', position: { x: 680, y: 220 }, params: { capacity: 2000, replicas: 1 } },
    ],
    edges: [...chain('users', 'lb', 'api', 'redis'), ...chain('api', 'db')],
  });

const twitterFeed = () =>
  parseDesign({
    name: 'Twitter-style feed',
    workload: { rps: 12000, readRatio: 0.95, objectSizeKb: 60 },
    nodes: [
      { id: 'users', type: 'client', label: 'Users', position: { x: 0, y: 160 } },
      { id: 'cdn', type: 'cdn', label: 'CDN (media)', position: { x: 200, y: 160 }, params: { hitRate: 0.6 } },
      { id: 'lb', type: 'loadBalancer', label: 'Load Balancer', position: { x: 400, y: 160 }, params: { instances: 2 } },
      { id: 'api', type: 'appServer', label: 'Timeline API', position: { x: 600, y: 160 }, params: { capacity: 1000, instances: 8, latencyMs: 8 } },
      { id: 'tl', type: 'cache', label: 'Timeline cache', position: { x: 840, y: 20 }, params: { hitRate: 0.85, capacity: 40000 } },
      { id: 'db', type: 'sqlDb', label: 'Tweets DB', position: { x: 840, y: 180 }, params: { capacity: 2500, replicas: 1, latencyMs: 6 } },
      { id: 'fanout', type: 'queue', label: 'Fan-out queue', position: { x: 840, y: 340 }, params: { consumerRate: 3000 } },
      { id: 'workers', type: 'worker', label: 'Fan-out workers', position: { x: 1060, y: 340 }, params: { capacity: 300, instances: 4, latencyMs: 25 } },
    ],
    edges: [...chain('users', 'cdn', 'lb', 'api', 'tl'), ...chain('api', 'db'), ...chain('api', 'fanout', 'workers', 'db')],
  });

const badDesign = () =>
  parseDesign({
    name: 'Deliberately bad design',
    workload: { rps: 1200, readRatio: 0.9, objectSizeKb: 300 },
    nodes: [
      { id: 'users', type: 'client', label: 'Users', position: { x: 0, y: 160 } },
      { id: 'web1', type: 'appServer', label: 'Web 1', position: { x: 200, y: 60 }, params: { capacity: 1000, instances: 1, latencyMs: 10 } },
      { id: 'web2', type: 'appServer', label: 'Web 2', position: { x: 200, y: 260 }, params: { capacity: 1000, instances: 1, latencyMs: 10 } },
      { id: 'auth', type: 'appServer', label: 'Auth service', position: { x: 420, y: 160 }, params: { capacity: 3000, instances: 1, latencyMs: 15 } },
      { id: 'profile', type: 'appServer', label: 'Profile service', position: { x: 640, y: 160 }, params: { capacity: 1500, instances: 2, latencyMs: 20 } },
      { id: 'orders', type: 'appServer', label: 'Orders service', position: { x: 860, y: 160 }, params: { capacity: 1500, instances: 2, latencyMs: 20 } },
      { id: 'db', type: 'sqlDb', label: 'The One Database', position: { x: 1080, y: 160 }, params: { capacity: 800, replicas: 0, latencyMs: 8 } },
      { id: 'email', type: 'queue', label: 'Email queue', position: { x: 1080, y: 320 }, params: { consumerRate: 500 } },
    ],
    edges: [
      ...chain('users', 'web1', 'auth', 'profile', 'orders', 'db'),
      ...chain('users', 'web2', 'auth'),
      ...chain('orders', 'email'),
    ],
  });

export const PRESETS: Preset[] = [
  { id: 'starter', name: 'Starter: 3-tier web app', description: 'Client → LB → app → DB.', build: starterDesign },
  { id: 'url-shortener', name: 'URL shortener', description: '99% reads, tiny objects, Redis in front of the links DB.', build: urlShortener },
  {
    id: 'twitter-feed',
    name: 'Twitter-style feed',
    description: 'CDN for media, timeline cache, async fan-out on write via a queue and workers.',
    build: twitterFeed,
  },
  {
    id: 'bad-design',
    name: 'Deliberately bad design',
    description: 'No LB, single instances, deep sync chain, an under-sized DB with no replica or cache, a queue with no workers, big objects without a CDN.',
    build: badDesign,
  },
];
