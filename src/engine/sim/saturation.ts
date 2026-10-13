import { computeFlows } from '../flow';
import type { Design } from '../types';
import { simulate, type SimResult } from './simulation';

export interface SaturationResult {
  /** Highest client rps the simulation sustained without saturating (≈ saturation point). */
  rps: number;
  /** Node that saturated first in the simulation. */
  bottleneckNodeId: string | null;
  /** Analytic (expected-value) estimate, for comparison. */
  analyticRps: number;
  analyticBottleneckNodeId: string | null;
  probes: { rps: number; saturated: boolean; bottleneckNodeId: string | null }[];
}

export interface SaturationOptions {
  seed?: number;
  durationSec?: number;
  iterations?: number;
}

/** A run is "saturated" if errors exceed 1% or any node is ≥ 97% busy (incl. undrained queues). */
export function isSaturated(r: SimResult): boolean {
  if (r.errorRate > 0.01) return true;
  return Object.values(r.nodes).some((n) => n.utilization >= 0.97);
}

/**
 * Find the load at which the design saturates by simulation: start from the analytic estimate,
 * bracket it, then bisect. Each probe is a short seeded run, so the answer is deterministic.
 */
export function findSaturation(design: Design, opts: SaturationOptions = {}): SaturationResult {
  const seed = opts.seed ?? 7;
  const durationSec = opts.durationSec ?? 6;
  const iterations = opts.iterations ?? 6;
  const flows = computeFlows(design, 1);
  const analyticRps = flows.bottleneck ? flows.bottleneck.saturationRps : Infinity;
  const probes: SaturationResult['probes'] = [];
  const empty = {
    rps: Infinity,
    bottleneckNodeId: null,
    analyticRps,
    analyticBottleneckNodeId: flows.bottleneck?.nodeId ?? null,
    probes,
  };
  if (!Number.isFinite(analyticRps)) return empty;
  if (analyticRps <= 0) return { ...empty, rps: 0, bottleneckNodeId: flows.bottleneck?.nodeId ?? null };

  let lastSaturatedBottleneck: string | null = null;
  // Keep probes cheap at very high loads: ~400k requests per probe at most.
  const probeSec = Math.min(durationSec, Math.max(2, 400_000 / analyticRps));
  const probe = (rps: number) => {
    const r = simulate(design, { rps, seed, durationSec: probeSec, warmupSec: Math.min(1, probeSec / 3), sampleIntervalSec: 1 });
    const saturated = isSaturated(r);
    const top = Object.values(r.nodes).reduce<{ id: string; u: number } | null>(
      (best, n) => (n.arrivals > 0 && (!best || n.utilization > best.u) ? { id: n.id, u: n.utilization } : best),
      null,
    );
    probes.push({ rps, saturated, bottleneckNodeId: top?.id ?? null });
    if (saturated) lastSaturatedBottleneck = top?.id ?? null;
    return saturated;
  };

  let lo = analyticRps * 0.5;
  let hi = analyticRps * 1.5;
  for (let i = 0; i < 4 && probe(lo); i++) {
    hi = lo;
    lo /= 2;
  }
  for (let i = 0; i < 4 && !probe(hi); i++) {
    lo = hi;
    hi *= 2;
  }
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (probe(mid)) hi = mid;
    else lo = mid;
  }
  return {
    rps: roundNice(lo),
    bottleneckNodeId: lastSaturatedBottleneck,
    analyticRps,
    analyticBottleneckNodeId: flows.bottleneck?.nodeId ?? null,
    probes,
  };
}

/** Round to 2–3 significant figures so results read like engineering estimates. */
export function roundNice(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return x;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / mag) * mag;
}
