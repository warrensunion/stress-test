import { describe, expect, it } from 'vitest';
import { buildAdvice } from '../src/engine/advice/advise';
import { applyFix } from '../src/engine/fixes';
import { lint } from '../src/engine/lint';
import { parseDesign, serializeDesign } from '../src/engine/schema';
import { findSaturation } from '../src/engine/sim/saturation';
import { simulate } from '../src/engine/sim/simulation';
import { PRESETS } from '../src/presets';

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.build();

describe('presets', () => {
  it.each(PRESETS.map((p) => p.id))('%s is valid, round-trips and simulates', (id) => {
    const d = preset(id);
    expect(parseDesign(JSON.parse(serializeDesign(d)))).toEqual(d);
    const r = simulate(d, { durationSec: 5 });
    expect(r.requests).toBeGreaterThan(0);
  });

  it('URL shortener and Twitter feed are healthy at their configured load', () => {
    for (const id of ['url-shortener', 'twitter-feed']) {
      const d = preset(id);
      expect(lint(d).filter((f) => f.severity === 'error')).toEqual([]);
      const r = simulate(d, { durationSec: 10 });
      expect(r.errorRate).toBeLessThan(0.01);
    }
  });

  it('Twitter feed processes fan-out asynchronously', () => {
    const r = simulate(preset('twitter-feed'), { durationSec: 10 });
    expect(r.async.processed).toBeGreaterThan(1000);
  });

  describe('deliberately bad design', () => {
    const d = preset('bad-design');

    it('trips many lint rules', () => {
      const ids = new Set(lint(d).map((f) => f.ruleId));
      for (const rule of [
        'db-single-point-of-failure',
        'single-app-instance',
        'multiple-app-no-lb',
        'read-heavy-no-cache',
        'deep-sync-chain',
        'queue-no-consumers',
        'cdn-missing-large-objects',
        'capacity-exceeded',
      ]) {
        expect(ids, rule).toContain(rule);
      }
    });

    it('simulation names the database as the bottleneck and shows failures', () => {
      const r = simulate(d, { durationSec: 15 });
      expect(r.bottleneck?.nodeId).toBe('db');
      expect(r.bottleneck?.saturated).toBe(true);
      expect(r.errorRate).toBeGreaterThan(0.05);
      expect(r.async.backlog).toBeGreaterThan(100); // email queue never drains
    });

    it('the top advice measurably improves the simulation', () => {
      const advice = buildAdvice(d, { maxCandidates: 4 });
      expect(advice.baseline.bottleneckNodeId).toBe('db');
      const top = advice.recommendations[0];
      expect(top.speedup).toBeGreaterThan(1.5);
      const fixed = applyFix(d, top.fix);
      const before = findSaturation(d);
      const after = findSaturation(fixed);
      expect(after.rps).toBeGreaterThan(before.rps * 1.5);
      const r = simulate(fixed, { durationSec: 15 });
      expect(r.errorRate).toBeLessThan(simulate(d, { durationSec: 15 }).errorRate);
    });
  });
});
