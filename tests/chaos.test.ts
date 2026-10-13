import { describe, expect, it } from 'vitest';
import { analyzeChaos } from '../src/engine/sim/chaosImpact';
import { simulate } from '../src/engine/sim/simulation';
import { mk } from './helpers';

const web = (replicas: number, appInstances = 3) =>
  mk(
    [
      ['c', 'client'],
      ['lb', 'loadBalancer'],
      ['app', 'appServer', { capacity: 500, instances: appInstances, latencyMs: 2 }],
      ['db', 'sqlDb', { capacity: 3000, replicas, latencyMs: 2 }],
    ],
    ['c>lb>app>db'],
    { rps: 1000, readRatio: 0.9 },
  );

describe('chaos impact', () => {
  it('killing a DB with no replica is a full outage', () => {
    const d = web(0);
    const r = simulate(d, { durationSec: 12, chaos: [{ atSec: 6, kind: 'kill', nodeId: 'db' }] });
    const impact = analyzeChaos(d, r)!;
    expect(impact.severity).toBe('outage');
    expect(impact.after.errorRate).toBeGreaterThan(0.99);
    expect(impact.verdict.join(' ')).toMatch(/no failover/);
  });

  it('killing a DB primary with replicas only fails writes', () => {
    const d = web(2);
    const r = simulate(d, { durationSec: 12, chaos: [{ atSec: 6, kind: 'kill', nodeId: 'db' }] });
    const impact = analyzeChaos(d, r)!;
    expect(impact.after.errorRate).toBeGreaterThan(0.05);
    expect(impact.after.errorRate).toBeLessThan(0.15); // ~10% writes
    expect(impact.verdict.join(' ')).toMatch(/replicas keep serving reads/);
  });

  it('losing one of three app instances at 67% load cascades into saturation', () => {
    const d = web(1);
    const r = simulate(d, { durationSec: 16, chaos: [{ atSec: 6, kind: 'killInstance', nodeId: 'app' }] });
    const impact = analyzeChaos(d, r)!;
    // 1000 rps on 2 × 500 = 100% → saturated, latency up, drops.
    expect(impact.saturatedAfter).toContain('app');
    expect(impact.after.p99Ms).toBeGreaterThan(impact.before.p99Ms * 2);
    expect(impact.severity).not.toBe('ok');
  });

  it('a 10x spike reports saturated nodes and latency blowup', () => {
    const d = web(1, 4);
    const r = simulate(d, { durationSec: 12, chaos: [{ atSec: 6, kind: 'spike', factor: 10 }] });
    const impact = analyzeChaos(d, r)!;
    expect(impact.after.offeredRps).toBeGreaterThan(impact.before.offeredRps * 7);
    expect(impact.saturatedAfter.length).toBeGreaterThan(0);
    expect(impact.severity).toBe('outage');
  });

  it('a well-provisioned design absorbs losing an instance', () => {
    const d = web(1, 6);
    const r = simulate(d, { durationSec: 12, chaos: [{ atSec: 6, kind: 'killInstance', nodeId: 'app' }] });
    const impact = analyzeChaos(d, r)!;
    expect(impact.severity).toBe('ok');
    expect(impact.cascaded).toEqual([]);
  });

  it('returns null without chaos', () => {
    const d = web(1);
    expect(analyzeChaos(d, simulate(d, { durationSec: 4 }))).toBeNull();
  });
});
