import { describe, expect, it } from 'vitest';
import { buildAdvice, titleFor } from '../src/engine/advice/advise';
import { explainAdvice, type Explainer } from '../src/engine/advice/explainer';
import { applyFix } from '../src/engine/fixes';
import { mk } from './helpers';

const dbBound = () =>
  mk(
    [
      ['c', 'client'],
      ['lb', 'loadBalancer', { instances: 2 }],
      ['app', 'appServer', { capacity: 2000, instances: 6 }],
      ['db', 'sqlDb', { capacity: 1000, replicas: 0 }],
    ],
    ['c>lb>app>db'],
    { rps: 800, readRatio: 0.9 },
  );

describe('advice loop', () => {
  it('names the DB bottleneck and recommends replicas/cache with measured gains', () => {
    const advice = buildAdvice(dbBound(), { maxCandidates: 3 });
    expect(advice.baseline.bottleneckNodeId).toBe('db');
    expect(advice.baseline.saturationRps).toBeGreaterThan(800);
    expect(advice.baseline.saturationRps).toBeLessThan(1100);
    const top = advice.recommendations[0];
    expect(['setParam', 'addSideCache']).toContain(top.fix.kind);
    expect(top.speedup).toBeGreaterThan(1.4);
    expect(top.after.saturationRps).toBeGreaterThan(advice.baseline.saturationRps * 1.4);
    expect(top.explanation).toMatch(/Re-simulated/);
    const replica = advice.recommendations.find((r) => r.fix.kind === 'setParam' && r.fix.param === 'replicas');
    expect(replica).toBeDefined();
  });

  it('applying the top recommendation actually raises the simulated saturation point', () => {
    const d = dbBound();
    const advice = buildAdvice(d, { maxCandidates: 2 });
    const fixed = applyFix(d, advice.recommendations[0].fix);
    const again = buildAdvice(fixed, { maxCandidates: 1 });
    expect(again.baseline.saturationRps).toBeGreaterThan(advice.baseline.saturationRps * 1.4);
  });

  it('recommends scaling an overloaded app tier', () => {
    const d = mk(
      [['c', 'client'], ['lb', 'loadBalancer', { instances: 2 }], ['app', 'appServer', { capacity: 500, instances: 2 }], ['db', 'sqlDb', { capacity: 50000, replicas: 1 }]],
      ['c>lb>app>db'],
      { rps: 1500, readRatio: 0.5 },
    );
    const advice = buildAdvice(d, { maxCandidates: 2 });
    expect(advice.baseline.bottleneckNodeId).toBe('app');
    expect(advice.baseline.errorRate).toBeGreaterThan(0.1);
    const top = advice.recommendations[0];
    expect(top.fix).toMatchObject({ kind: 'setParam', nodeId: 'app', param: 'instances' });
    expect(top.after.errorRate).toBeLessThan(0.01);
  });

  it('titles fixes readably', () => {
    const d = dbBound();
    expect(titleFor(d, { kind: 'setParam', nodeId: 'db', param: 'replicas', value: 2 })).toBe('Add 2 read replicas to SQL Database');
  });

  it('explanations come from a pluggable explainer', async () => {
    const d = dbBound();
    const advice = buildAdvice(d, { maxCandidates: 1 });
    const fake: Explainer = { name: 'fake-llm', explain: async ({ rec }) => `LLM says: ${rec.title}` };
    const explained = await explainAdvice(d, advice, fake);
    expect(explained.recommendations[0].explanation).toBe(`LLM says: ${advice.recommendations[0].title}`);
  });
});
