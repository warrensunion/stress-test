import { describe, expect, it } from 'vitest';
import { DEFAULT_ESTIMATOR_INPUT, bytes, estimate, fmt } from '../src/engine/estimator';

const get = (out: ReturnType<typeof estimate>, key: string) => out.metrics.find((m) => m.key === key)!.value;

describe('estimator', () => {
  it('computes QPS from DAU', () => {
    const out = estimate({ ...DEFAULT_ESTIMATOR_INPUT, dau: 86_400, requestsPerUserPerDay: 10, peakMultiplier: 4 });
    expect(get(out, 'avgQps')).toBeCloseTo(10);
    expect(get(out, 'peakQps')).toBeCloseTo(40);
  });

  it('splits reads and writes by ratio', () => {
    const out = estimate({ ...DEFAULT_ESTIMATOR_INPUT, dau: 86_400, requestsPerUserPerDay: 11, readWriteRatio: 10 });
    expect(get(out, 'readQps')).toBeCloseTo(10);
    expect(get(out, 'writeQps')).toBeCloseTo(1);
  });

  it('computes storage growth from writes only', () => {
    const out = estimate({
      ...DEFAULT_ESTIMATOR_INPUT,
      dau: 86_400,
      requestsPerUserPerDay: 2,
      readWriteRatio: 1, // 1 write/s
      avgObjectSizeKb: 1,
      retentionYears: 2,
      replicationFactor: 3,
    });
    const perYear = 1 * 86_400 * 365 * 1024;
    expect(get(out, 'storagePerYear')).toBeCloseTo(perYear);
    expect(get(out, 'storageTotal')).toBeCloseTo(perYear * 2);
    expect(get(out, 'storageReplicated')).toBeCloseTo(perYear * 6);
    expect(out.storageByYear).toHaveLength(2);
  });

  it('every metric shows its formula', () => {
    for (const m of estimate(DEFAULT_ESTIMATOR_INPUT).metrics) {
      expect(m.formula.length).toBeGreaterThan(0);
      expect(m.substituted).toContain('=');
    }
  });

  it('formats numbers', () => {
    expect(fmt(1_500_000)).toBe('1.5M');
    expect(fmt(12)).toBe('12');
    expect(bytes(1024 * 1024)).toBe('1 MB');
  });
});
