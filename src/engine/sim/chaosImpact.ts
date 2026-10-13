import { fmt } from '../estimator';
import type { Design } from '../types';
import type { ChaosEvent, SeriesPoint, SimResult } from './simulation';

// Summarize "what broke" after a chaos event by comparing the time series before and after it.

export interface ChaosImpact {
  event: ChaosEvent;
  before: WindowStats;
  after: WindowStats;
  /** Nodes that were healthy before and saturated after (other than the one directly targeted). */
  cascaded: string[];
  /** Nodes that were saturated after the event (including the target). */
  saturatedAfter: string[];
  /** Plain-language findings, most important first. */
  verdict: string[];
  severity: 'ok' | 'degraded' | 'outage';
}

export interface WindowStats {
  offeredRps: number;
  throughputRps: number;
  errorRate: number;
  p99Ms: number;
}

function stats(points: SeriesPoint[]): WindowStats {
  if (!points.length) return { offeredRps: 0, throughputRps: 0, errorRate: 0, p99Ms: 0 };
  const sum = (f: (p: SeriesPoint) => number) => points.reduce((s, p) => s + f(p), 0);
  const ok = sum((p) => p.throughputRps);
  const err = sum((p) => p.errorRps);
  return {
    offeredRps: sum((p) => p.offeredRps) / points.length,
    throughputRps: ok / points.length,
    errorRate: ok + err > 0 ? err / (ok + err) : 0,
    p99Ms: Math.max(...points.map((p) => p.p99)),
  };
}

const avgUtil = (points: SeriesPoint[], id: string) =>
  points.length ? points.reduce((s, p) => s + Math.min(p.util[id] ?? 0, 2), 0) / points.length : 0;

const queueGrowing = (points: SeriesPoint[], id: string) => {
  if (points.length < 4) return false;
  const first = points[Math.floor(points.length / 4)].queues[id] ?? 0;
  const last = points[points.length - 1].queues[id] ?? 0;
  return last > 50 && last > first * 2;
};

export function analyzeChaos(design: Design, result: SimResult, warmupSec = 2): ChaosImpact | null {
  const event = result.chaosLog[0];
  if (!event) return null;
  const t0 = event.atSec;
  const next = result.chaosLog[1]?.atSec ?? Infinity;
  const before = result.series.filter((p) => p.t > Math.max(warmupSec, t0 - 5) && p.t <= t0);
  // Skip the first second after the event so in-flight work settles.
  const after = result.series.filter((p) => p.t > t0 + 1 && p.t <= next);
  if (!after.length) return null;

  const b = stats(before);
  const a = stats(after);
  const label = (id: string) => design.nodes.find((n) => n.id === id)?.label ?? id;
  const target = 'nodeId' in event ? event.nodeId : null;

  const ids = Object.keys(result.nodes);
  const hot = (pts: SeriesPoint[], id: string) => avgUtil(pts, id) >= 0.95 || queueGrowing(pts, id);
  const saturatedAfter = ids.filter((id) => hot(after, id));
  // A spike hits every node directly, so saturation there isn't a cascade.
  const cascaded = event.kind === 'spike' ? [] : saturatedAfter.filter((id) => id !== target && !hot(before, id));

  const verdict: string[] = [];
  const what =
    event.kind === 'spike'
      ? `Traffic spike ×${event.factor}`
      : event.kind === 'latency'
        ? `+${event.addMs} ms latency on ${label(event.nodeId)}`
        : event.kind === 'kill'
          ? `Killing ${label(event.nodeId)}`
          : event.kind === 'killInstance'
            ? `Losing one ${label(event.nodeId)} instance`
            : `Reviving ${label(event.nodeId)}`;

  const errDelta = a.errorRate - b.errorRate;
  if (a.errorRate >= 0.99) verdict.push(`${what} caused a full outage: ${pct(a.errorRate)} of requests fail.`);
  else if (errDelta > 0.01) verdict.push(`${what} raised the error rate from ${pct(b.errorRate)} to ${pct(a.errorRate)}.`);
  else verdict.push(`${what}: no increase in errors (${pct(a.errorRate)}).`);

  if (b.p99Ms > 0 && a.p99Ms > b.p99Ms * 2 && a.errorRate < 0.99) {
    verdict.push(`p99 latency blew up from ${fmt(b.p99Ms)} ms to ${fmt(a.p99Ms)} ms.`);
  }
  if (cascaded.length) {
    verdict.push(`Cascading failure: ${cascaded.map(label).join(', ')} became saturated as load shifted or backed up.`);
  } else if (saturatedAfter.length && event.kind === 'spike') {
    verdict.push(`Saturated: ${saturatedAfter.map(label).join(', ')}.`);
  }
  if (event.kind === 'kill' && a.errorRate < 0.01) verdict.push('The design absorbed the failure — redundancy worked.');
  if (event.kind === 'kill' && design.nodes.find((n) => n.id === target)?.type === 'sqlDb') {
    const db = design.nodes.find((n) => n.id === target)!;
    verdict.push(
      (db.params.replicas ?? 0) > 0
        ? 'The primary is down: writes fail, but replicas keep serving reads.'
        : 'With no replica there is no failover: every request touching the database fails.',
    );
  }
  if (a.offeredRps > 0 && a.throughputRps < a.offeredRps * 0.5 && a.errorRate < 0.99) {
    verdict.push(`Only ${fmt(a.throughputRps)} of ${fmt(a.offeredRps)} req/s succeed.`);
  }

  const severity: ChaosImpact['severity'] = a.errorRate >= 0.5 ? 'outage' : errDelta > 0.01 || a.p99Ms > b.p99Ms * 2 ? 'degraded' : 'ok';
  return { event, before: b, after: a, cascaded, saturatedAfter, verdict, severity };
}

const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`;
