import { describe, expect, it } from 'vitest';
import { computeFlows } from '../src/engine/flow';
import { mk } from './helpers';

describe('analytic flow model', () => {
  it('a load balancer splits evenly', () => {
    const d = mk(
      [['c', 'client'], ['lb', 'loadBalancer'], ['a', 'appServer'], ['b', 'appServer']],
      ['c>lb>a', 'lb>b'],
      { rps: 1000 },
    );
    const f = computeFlows(d);
    expect(f.nodes.a.rate).toBeCloseTo(500);
    expect(f.nodes.b.rate).toBeCloseTo(500);
  });

  it('writes pass through an in-line cache (and add load to it)', () => {
    const d = mk(
      [['c', 'client'], ['app', 'appServer'], ['cache', 'cache', { hitRate: 0.5 }], ['db', 'sqlDb']],
      ['c>app>cache>db'],
      { rps: 1000, readRatio: 0.5 },
    );
    const f = computeFlows(d);
    expect(f.nodes.cache.rate).toBeCloseTo(1000);
    expect(f.nodes.db.readRate).toBeCloseTo(250);
    expect(f.nodes.db.writeRate).toBeCloseTo(500);
  });

  it('DB utilization accounts for writes pinned to the primary', () => {
    const d = mk(
      [['c', 'client'], ['db', 'sqlDb', { capacity: 1000, replicas: 3 }]],
      ['c>db'],
      { rps: 1000, readRatio: 0.2 }, // 800 writes/s must all hit the single primary
    );
    expect(computeFlows(d).nodes.db.utilization).toBeCloseTo(0.8);
  });

  it('saturation rps scales inversely with utilization', () => {
    const d = mk([['c', 'client'], ['s', 'appServer', { capacity: 500, instances: 2 }]], ['c>s'], { rps: 250 });
    const f = computeFlows(d);
    expect(f.nodes.s.utilization).toBeCloseTo(0.25);
    expect(f.bottleneck?.saturationRps).toBeCloseTo(1000);
  });
});
