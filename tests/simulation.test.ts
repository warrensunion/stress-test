import { describe, expect, it } from 'vitest';
import { computeFlows } from '../src/engine/flow';
import { findSaturation } from '../src/engine/sim/saturation';
import { Simulation, simulate } from '../src/engine/sim/simulation';
import { mk, mm1 } from './helpers';

describe('single node (M/M/1)', () => {
  it('at 50% load has low queueing and no errors', () => {
    const r = simulate(mm1(500, 1000), { durationSec: 30 });
    const s = r.nodes.s;
    expect(s.utilization).toBeGreaterThan(0.45);
    expect(s.utilization).toBeLessThan(0.55);
    expect(s.avgQueue).toBeLessThan(2); // theory: Lq = rho^2/(1-rho) = 0.5
    expect(r.errorRate).toBe(0);
  });

  it.each([0.5, 0.8, 0.9])('matches M/M/1 theory at rho=%s', (rho) => {
    const mu = 1000;
    const lambda = rho * mu;
    const r = simulate(mm1(lambda, mu, 1e9), { durationSec: rho >= 0.9 ? 120 : 60, warmupSec: 5, seed: 1 });
    const theoryW = 1000 / (mu - lambda); // mean time in system, ms
    const theoryLq = (rho * rho) / (1 - rho);
    const theoryP99 = (Math.log(100) * 1000) / (mu - lambda); // sojourn time ~ Exp(mu - lambda)
    expect(r.latencyMs.mean).toBeGreaterThan(theoryW * 0.85);
    expect(r.latencyMs.mean).toBeLessThan(theoryW * 1.15);
    expect(r.latencyMs.p99).toBeGreaterThan(theoryP99 * 0.8);
    expect(r.latencyMs.p99).toBeLessThan(theoryP99 * 1.2);
    expect(r.nodes.s.avgQueue).toBeGreaterThan(theoryLq * 0.7);
    expect(r.nodes.s.avgQueue).toBeLessThan(theoryLq * 1.3);
  });

  it('above 100% load the queue grows without bound', () => {
    const r = simulate(mm1(1500, 1000, 1e9), { durationSec: 20, warmupSec: 0 });
    const q = r.series.map((p) => p.queues.s);
    // Expected growth = (lambda - mu) * t = 500/s.
    expect(r.nodes.s.finalQueue).toBeGreaterThan(500 * 20 * 0.85);
    expect(r.nodes.s.finalQueue).toBeLessThan(500 * 20 * 1.15);
    expect(q[q.length - 1]).toBeGreaterThan(q[Math.floor(q.length / 2)] * 1.5);
    expect(r.nodes.s.utilization).toBeGreaterThan(0.99);
  });

  it('above 100% load with a bounded queue drops requests', () => {
    const r = simulate(mm1(1500, 1000), { durationSec: 10 });
    expect(r.errors.dropped).toBeGreaterThan(0);
    expect(r.errorRate).toBeGreaterThan(0.25); // about 1/3 of traffic cannot be served
    expect(r.bottleneck?.nodeId).toBe('s');
    expect(r.bottleneck?.saturated).toBe(true);
  });
});

const dbDesign = (replicas: number, rps = 1500) =>
  mk(
    [
      ['c', 'client'],
      ['app', 'appServer', { capacity: 10000, instances: 2, latencyMs: 1 }],
      ['db', 'sqlDb', { capacity: 1000, instances: 1, replicas, latencyMs: 1 }],
    ],
    ['c>app>db'],
    { rps, readRatio: 0.9 },
  );

describe('read replicas', () => {
  it('adding replicas raises the saturation point', () => {
    const a0 = computeFlows(dbDesign(0), 1).nodes.db.saturationRps;
    const a2 = computeFlows(dbDesign(2), 1).nodes.db.saturationRps;
    expect(a0).toBeCloseTo(1000);
    expect(a2).toBeCloseTo(3000);
    const s0 = findSaturation(dbDesign(0));
    const s2 = findSaturation(dbDesign(2));
    expect(s0.bottleneckNodeId).toBe('db');
    expect(s2.rps).toBeGreaterThan(s0.rps * 2.5);
    expect(s0.rps).toBeGreaterThan(850);
    expect(s0.rps).toBeLessThan(1050);
  });

  it('a saturated primary recovers when replicas are added', () => {
    const before = simulate(dbDesign(0), { durationSec: 10 });
    const after = simulate(dbDesign(2), { durationSec: 10 });
    expect(before.nodes.db.utilization).toBeGreaterThan(0.95);
    expect(before.errorRate).toBeGreaterThan(0.1);
    expect(after.errorRate).toBe(0);
    expect(after.nodes.db.utilization).toBeLessThan(0.7);
  });
});

describe('cache', () => {
  const withCache = (hitRate: number | null) =>
    mk(
      [
        ['c', 'client'],
        ['app', 'appServer', { capacity: 10000, instances: 1 }],
        ['cache', 'cache', { capacity: 50000, hitRate: hitRate ?? 0 }],
        ['db', 'sqlDb', { capacity: 50000 }],
      ],
      hitRate === null ? ['c>app>db'] : ['c>app>cache', 'app>db'], // side cache (cache-aside)
      { rps: 2000, readRatio: 1 },
    );

  it('a 90% hit rate cuts DB load ~10x', () => {
    const none = simulate(withCache(null), { durationSec: 20 });
    const cached = simulate(withCache(0.9), { durationSec: 20 });
    const ratio = none.nodes.db.arrivalRate / cached.nodes.db.arrivalRate;
    expect(ratio).toBeGreaterThan(8.5);
    expect(ratio).toBeLessThan(11.5);
    expect(computeFlows(withCache(0.9)).nodes.db.rate).toBeCloseTo(200);
  });

  it('writes bypass a side cache', () => {
    const d = { ...withCache(0.9), workload: { rps: 1000, readRatio: 0, objectSizeKb: 1 } };
    const f = computeFlows(d);
    expect(f.nodes.cache.rate).toBe(0);
    expect(f.nodes.db.writeRate).toBeCloseTo(1000);
  });
});

describe('message queue', () => {
  const pipeline = (workers: boolean, consumerRate = 2000) =>
    mk(
      [
        ['c', 'client'],
        ['app', 'appServer', { capacity: 5000, instances: 1, latencyMs: 2 }],
        ['q', 'queue', { consumerRate, latencyMs: 1 }],
        ['w', 'worker', { capacity: 400, instances: 3, latencyMs: 5 }],
        ['db', 'sqlDb', { capacity: 5000 }],
      ],
      workers ? ['c>app>q>w>db'] : ['c>app>q'],
      { rps: 1000, readRatio: 0 },
    );

  it('decouples producers: sync latency excludes worker time', () => {
    const r = simulate(pipeline(true), { durationSec: 15 });
    expect(r.errorRate).toBe(0);
    expect(r.latencyMs.p50).toBeLessThan(10);
    expect(r.async.processed).toBeGreaterThan(10000);
    expect(r.nodes.db.arrivalRate).toBeGreaterThan(900);
  });

  it('a queue with no workers accumulates a backlog', () => {
    const r = simulate(pipeline(false), { durationSec: 10, warmupSec: 0 });
    expect(r.async.backlog).toBeGreaterThan(8000);
    expect(r.nodes.q.utilization).toBe(Infinity);
    expect(r.errorRate).toBe(0); // producers still get acks
  });

  it('workers slower than arrivals: backlog grows and the worker is the bottleneck', () => {
    const d = pipeline(true);
    d.workload.rps = 1500; // workers can do 1200/s
    const r = simulate(d, { durationSec: 15 });
    expect(r.async.backlog).toBeGreaterThan(2000);
    expect(r.nodes.w.utilization).toBeGreaterThan(0.95);
  });
});

describe('determinism', () => {
  it('same seed gives identical results; different seed differs', () => {
    const a = simulate(dbDesign(1), { durationSec: 5, seed: 3 });
    const b = simulate(dbDesign(1), { durationSec: 5, seed: 3 });
    const c = simulate(dbDesign(1), { durationSec: 5, seed: 4 });
    expect(a).toEqual(b);
    expect(a.latencyMs).not.toEqual(c.latencyMs);
  });
});

describe('chaos', () => {
  const lbDesign = () =>
    mk(
      [
        ['c', 'client'],
        ['lb', 'loadBalancer'],
        ['a1', 'appServer', { capacity: 600, instances: 1, latencyMs: 2 }],
        ['a2', 'appServer', { capacity: 600, instances: 1, latencyMs: 2 }],
        ['db', 'sqlDb', { capacity: 5000, replicas: 0 }],
      ],
      ['c>lb>a1>db', 'lb>a2>db'],
      { rps: 500 },
    );

  it('killing the DB mid-run causes errors only after the kill', () => {
    const r = simulate(lbDesign(), { durationSec: 10, chaos: [{ atSec: 5, kind: 'kill', nodeId: 'db' }] });
    const before = r.series.filter((p) => p.t <= 5);
    const after = r.series.filter((p) => p.t > 5.5);
    expect(before.every((p) => p.errorRps === 0)).toBe(true);
    expect(after.every((p) => p.throughputRps === 0)).toBe(true);
    expect(r.errors.unavailable).toBeGreaterThan(1000);
  });

  it('the LB routes around a dead app server; the survivor absorbs the load', () => {
    const r = simulate(lbDesign(), { durationSec: 10, chaos: [{ atSec: 5, kind: 'kill', nodeId: 'a1' }] });
    const after = r.series.filter((p) => p.t > 6);
    const meanUtil = after.reduce((s, p) => s + p.util.a2, 0) / after.length;
    expect(meanUtil).toBeGreaterThan(0.75); // 500 rps on a 600 rps server
    expect(after.every((p) => p.util.a2 > 0.6)).toBe(true);
    expect(r.errorRate).toBeLessThan(0.01);
  });

  it('a 10x spike overloads the system (drops + latency blowup)', () => {
    const r = simulate(lbDesign(), { durationSec: 10, chaos: [{ atSec: 5, kind: 'spike', factor: 10 }] });
    const before = r.series.filter((p) => p.t <= 5 && p.t > 2);
    const after = r.series.filter((p) => p.t > 6);
    expect(after[0].offeredRps).toBeGreaterThan(before[0].offeredRps * 7);
    expect(Math.max(...after.map((p) => p.p99))).toBeGreaterThan(Math.max(...before.map((p) => p.p99)) * 5);
    expect(r.errors.dropped).toBeGreaterThan(0);
  });

  it('added latency shows up end-to-end', () => {
    const r = simulate(lbDesign(), {
      durationSec: 10,
      chaos: [{ atSec: 5, kind: 'latency', nodeId: 'db', addMs: 200 }],
    });
    const late = r.series.filter((p) => p.t > 6);
    expect(late.every((p) => p.p50 > 200)).toBe(true);
  });

  it('live injection behaves like a scheduled event', () => {
    const live = new Simulation(lbDesign(), { durationSec: 10 });
    live.runUntil(5);
    live.inject({ kind: 'kill', nodeId: 'db' });
    live.runUntil(10);
    const scheduled = simulate(lbDesign(), { durationSec: 10, chaos: [{ atSec: 5, kind: 'kill', nodeId: 'db' }] });
    const a = live.result().errors.unavailable;
    const b = scheduled.errors.unavailable;
    expect(Math.abs(a - b) / b).toBeLessThan(0.05);
  });
});
