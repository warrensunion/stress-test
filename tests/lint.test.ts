import { describe, expect, it } from 'vitest';
import { applyFix } from '../src/engine/fixes';
import { lint, RULES } from '../src/engine/lint';
import { mk } from './helpers';

const ids = (d: Parameters<typeof lint>[0]) => lint(d).map((f) => f.ruleId);

/** A healthy design that should produce no warnings or errors. */
const good = () =>
  mk(
    [
      ['c', 'client'],
      ['lb', 'loadBalancer', { instances: 2 }],
      ['app', 'appServer', { instances: 4, capacity: 1000 }],
      ['cache', 'cache', { hitRate: 0.9 }],
      ['db', 'sqlDb', { replicas: 2, capacity: 2000 }],
    ],
    ['c>lb>app>cache', 'app>db'],
    { rps: 2000, readRatio: 0.9, objectSizeKb: 2 },
  );

describe('linter', () => {
  it('has at least 10 rules, each documented', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(10);
    for (const r of RULES) {
      expect(r.id).toMatch(/^[a-z-]+$/);
      expect(r.why.length).toBeGreaterThan(30);
      expect(r.title.length).toBeGreaterThan(5);
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it('a healthy design has no errors or warnings', () => {
    const f = lint(good()).filter((x) => x.severity !== 'info');
    expect(f).toEqual([]);
  });

  it('every finding carries a message, why and fix', () => {
    const bad = mk([['c', 'client'], ['db', 'sqlDb']], ['c>db'], { rps: 5000 });
    for (const f of lint(bad)) {
      expect(f.message).toBeTruthy();
      expect(f.why).toBeTruthy();
      expect(f.fix).toBeTruthy();
    }
  });

  it('no-client', () => {
    expect(ids(mk([['app', 'appServer']], []))).toContain('no-client');
  });

  it('cycle', () => {
    const d = mk([['c', 'client'], ['a', 'appServer'], ['b', 'appServer']], ['c>a>b>a']);
    const f = lint(d).find((x) => x.ruleId === 'cycle')!;
    expect(f.nodeIds.sort()).toEqual(['a', 'b']);
  });

  it('orphan-node', () => {
    const d = mk([['c', 'client'], ['a', 'appServer'], ['z', 'cache']], ['c>a']);
    expect(lint(d).find((f) => f.ruleId === 'orphan-node')?.nodeIds).toEqual(['z']);
  });

  it('client-direct-db', () => {
    expect(ids(mk([['c', 'client'], ['db', 'sqlDb']], ['c>db']))).toContain('client-direct-db');
  });

  it('db-single-point-of-failure, fixed by adding a replica', () => {
    const d = mk([['c', 'client'], ['a', 'appServer'], ['db', 'sqlDb', { replicas: 0 }]], ['c>a>db'], { rps: 100 });
    const f = lint(d).find((x) => x.ruleId === 'db-single-point-of-failure')!;
    expect(f).toBeDefined();
    expect(ids(applyFix(d, f.autoFix!))).not.toContain('db-single-point-of-failure');
  });

  it('single-app-instance (but not when several app servers share an LB)', () => {
    const single = mk([['c', 'client'], ['lb', 'loadBalancer'], ['a', 'appServer', { instances: 1 }]], ['c>lb>a'], { rps: 10 });
    expect(ids(single)).toContain('single-app-instance');
    const pair = mk(
      [['c', 'client'], ['lb', 'loadBalancer'], ['a', 'appServer', { instances: 1 }], ['b', 'appServer', { instances: 1 }]],
      ['c>lb>a', 'lb>b'],
      { rps: 10 },
    );
    expect(ids(pair)).not.toContain('single-app-instance');
  });

  it('multiple-app-no-lb, fixed by inserting a load balancer', () => {
    const d = mk([['c', 'client'], ['a', 'appServer'], ['b', 'appServer']], ['c>a', 'c>b'], { rps: 100 });
    const f = lint(d).find((x) => x.ruleId === 'multiple-app-no-lb')!;
    expect(f.nodeIds).toEqual(['c', 'a', 'b']);
    const fixed = applyFix(d, f.autoFix!);
    expect(ids(fixed)).not.toContain('multiple-app-no-lb');
    expect(fixed.nodes.some((n) => n.type === 'loadBalancer')).toBe(true);
  });

  it('read-heavy-no-cache, fixed by adding a side cache', () => {
    const d = mk([['c', 'client'], ['a', 'appServer'], ['db', 'sqlDb']], ['c>a>db'], { rps: 100, readRatio: 0.95 });
    const f = lint(d).find((x) => x.ruleId === 'read-heavy-no-cache')!;
    expect(f).toBeDefined();
    const fixed = applyFix(d, f.autoFix!);
    expect(ids(fixed)).not.toContain('read-heavy-no-cache');
    // Not triggered for write-heavy workloads.
    expect(ids({ ...d, workload: { ...d.workload, readRatio: 0.3 } })).not.toContain('read-heavy-no-cache');
  });

  it('deep-sync-chain (> 4 hops), but queues break the chain', () => {
    const deep = mk(
      [['c', 'client'], ['a', 'appServer'], ['b', 'appServer'], ['d', 'appServer'], ['e', 'appServer'], ['f', 'appServer']],
      ['c>a>b>d>e>f'],
      { rps: 10 },
    );
    expect(ids(deep)).toContain('deep-sync-chain');
    const withQueue = mk(
      [['c', 'client'], ['a', 'appServer'], ['q', 'queue'], ['w', 'worker'], ['b', 'appServer'], ['d', 'appServer']],
      ['c>a>q>w>b>d'],
      { rps: 10 },
    );
    expect(ids(withQueue)).not.toContain('deep-sync-chain');
  });

  it('queue-no-consumers, fixed by adding workers', () => {
    const d = mk([['c', 'client'], ['a', 'appServer'], ['q', 'queue']], ['c>a>q'], { rps: 100, readRatio: 0 });
    const f = lint(d).find((x) => x.ruleId === 'queue-no-consumers')!;
    expect(f).toBeDefined();
    expect(ids(applyFix(d, f.autoFix!))).not.toContain('queue-no-consumers');
  });

  it('queue-backlog-growth', () => {
    const d = mk(
      [['c', 'client'], ['a', 'appServer', { capacity: 10000 }], ['q', 'queue', { consumerRate: 100 }], ['w', 'worker']],
      ['c>a>q>w'],
      { rps: 1000, readRatio: 0 },
    );
    const f = lint(d).find((x) => x.ruleId === 'queue-backlog-growth')!;
    expect(f).toBeDefined();
    expect(ids(applyFix(d, f.autoFix!))).not.toContain('queue-backlog-growth');
  });

  it('cache-on-write-path', () => {
    const d = mk([['c', 'client'], ['a', 'appServer'], ['k', 'cache'], ['db', 'sqlDb']], ['c>a>k>db'], { rps: 100, readRatio: 0.2 });
    expect(ids(d)).toContain('cache-on-write-path');
  });

  it('cdn-missing-large-objects', () => {
    const d = mk([['c', 'client'], ['a', 'appServer']], ['c>a'], { rps: 100, objectSizeKb: 500, readRatio: 0.9 });
    expect(ids(d)).toContain('cdn-missing-large-objects');
    expect(ids({ ...d, workload: { ...d.workload, objectSizeKb: 4 } })).not.toContain('cdn-missing-large-objects');
  });

  it('capacity-exceeded and high-utilization, fixed by scaling', () => {
    const over = mk([['c', 'client'], ['a', 'appServer', { capacity: 100, instances: 2 }]], ['c>a'], { rps: 500 });
    const f = lint(over).find((x) => x.ruleId === 'capacity-exceeded')!;
    expect(f.autoFix).toEqual({ kind: 'setParam', nodeId: 'a', param: 'instances', value: 8 });
    const fixed = ids(applyFix(over, f.autoFix!));
    expect(fixed).not.toContain('capacity-exceeded');
    expect(fixed).not.toContain('high-utilization');
    const hot = mk([['c', 'client'], ['a', 'appServer', { capacity: 100, instances: 2 }]], ['c>a'], { rps: 170 });
    expect(ids(hot)).toContain('high-utilization');
  });

  it('low-cache-hit-rate and single-load-balancer are informational', () => {
    const d = mk([['c', 'client'], ['lb', 'loadBalancer'], ['a', 'appServer'], ['k', 'cache', { hitRate: 0.2 }]], ['c>lb>a>k'], { rps: 10 });
    const f = lint(d);
    expect(f.find((x) => x.ruleId === 'low-cache-hit-rate')?.severity).toBe('info');
    expect(f.find((x) => x.ruleId === 'single-load-balancer')?.severity).toBe('info');
  });
});
