import { isCacheLike } from '../components';
import { fmt } from '../estimator';
import { applyFix, describeFix, scaleFixFor, type Fix } from '../fixes';
import { computeFlows } from '../flow';
import { buildGraph } from '../graph';
import { lint, type Severity } from '../lint';
import { findSaturation } from '../sim/saturation';
import { simulate } from '../sim/simulation';
import type { Design } from '../types';
import { templateExplainer } from './explainer';
import type { Advice, Measurement, Recommendation } from './types';

// The advice loop: measure the design by simulation, generate candidate fixes from the
// bottleneck and from lint findings, re-simulate each candidate, and rank by measured gain.

export interface AdviceOptions {
  seed?: number;
  /** Max candidate fixes to re-simulate. */
  maxCandidates?: number;
}

interface Candidate {
  source: Recommendation['source'];
  severity: Severity;
  title: string;
  problem: string;
  nodeIds: string[];
  fix: Fix;
}

export function measure(design: Design, seed = 7): Measurement {
  const sat = findSaturation(design, { seed, durationSec: 3, iterations: 5 });
  const run = simulate(design, { durationSec: 10, seed, warmupSec: 2, sampleIntervalSec: 1 });
  return {
    saturationRps: sat.rps,
    bottleneckNodeId: sat.bottleneckNodeId ?? sat.analyticBottleneckNodeId ?? run.bottleneck?.nodeId ?? null,
    p99Ms: run.latencyMs.p99,
    errorRate: run.errorRate,
  };
}

export function titleFor(design: Design, fix: Fix): string {
  const label = (id: string) => design.nodes.find((n) => n.id === id)?.label ?? id;
  switch (fix.kind) {
    case 'setParam': {
      const node = design.nodes.find((n) => n.id === fix.nodeId);
      const from = node?.params[fix.param] ?? 0;
      if (fix.param === 'replicas') return `Add ${fix.value - from} read replica${fix.value - from === 1 ? '' : 's'} to ${label(fix.nodeId)}`;
      if (fix.param === 'instances') return `Scale ${label(fix.nodeId)} to ${fix.value} instances`;
      if (fix.param === 'consumerRate') return `Raise ${label(fix.nodeId)} consumer rate to ${fmt(fix.value)}/s`;
      if (fix.param === 'capacity') return `Scale up ${label(fix.nodeId)} to ${fmt(fix.value)} req/s per instance`;
      return describeFix(design, fix);
    }
    case 'addSideCache':
      return `Cache reads in front of ${label(fix.dbId)}`;
    case 'addLoadBalancer':
      return `Add a load balancer in front of ${fix.targetIds.map(label).join(', ')}`;
    case 'addWorker':
      return `Add workers for ${label(fix.queueId)}`;
    case 'batch':
      return fix.fixes.map((f) => titleFor(design, f)).join(' + ');
  }
}

/** Identity of a fix ignoring its magnitude, used to de-duplicate candidates. */
const fixKey = (f: Fix): string =>
  f.kind === 'setParam' ? `set:${f.nodeId}:${f.param}` : f.kind === 'batch' ? f.fixes.map(fixKey).join('+') : JSON.stringify(f);

function bottleneckCandidates(design: Design, baseline: Measurement): Candidate[] {
  const id = baseline.bottleneckNodeId;
  const node = design.nodes.find((n) => n.id === id);
  if (!id || !node) return [];
  const sat = baseline.saturationRps;
  // Size the fix for 2× the current limit (or the configured load if that is higher).
  const target = Math.max(design.workload.rps, Number.isFinite(sat) ? sat * 2 : design.workload.rps);
  const flowsAtTarget = computeFlows(design, target);
  const flowsAtSat = computeFlows(design, Number.isFinite(sat) && sat > 0 ? sat : design.workload.rps);
  const f = flowsAtSat.nodes[id];
  const cap = node.params.capacity * node.params.instances;
  let detail = '';
  if (node.type === 'sqlDb' && f) {
    detail = ` At that load it receives ${fmt(f.readRate)} reads/s and ${fmt(f.writeRate)} writes/s across ${node.params.instances + (node.params.replicas ?? 0)} server(s) of ${fmt(node.params.capacity)} req/s.`;
  } else if (node.type === 'queue' && f) {
    detail = ` Messages arrive at ${fmt(f.rate)}/s but drain at only ${fmt(f.rate / Math.max(f.utilization, 1e-9))}/s.`;
  } else if (f) {
    detail = ` At that load it receives ${fmt(f.rate)} req/s against ${fmt(cap)} req/s of capacity (${node.params.instances} × ${fmt(node.params.capacity)}).`;
  }
  const problem = Number.isFinite(sat)
    ? `${node.label} is the first bottleneck: the simulated system saturates at ${fmt(sat)} req/s${sat < design.workload.rps ? `, below your configured ${fmt(design.workload.rps)} req/s` : ''}.${detail}`
    : `${node.label} is the most loaded component.`;

  const out: Candidate[] = [];
  const scale = scaleFixFor(design, flowsAtTarget, id, 0.8);
  if (scale) out.push({ source: 'simulation', severity: sat < design.workload.rps ? 'error' : 'warning', title: titleFor(design, scale), problem, nodeIds: [id], fix: scale });

  // Read-heavy DB bottleneck with no cache: caching is usually the bigger lever.
  if (node.type === 'sqlDb' && f && f.readRate > f.writeRate) {
    const g = buildGraph(design);
    const callers = (g.ins.get(id) ?? []).map((c) => g.nodes.get(c)!);
    const cached = callers.some((c) => isCacheLike(c.type) || (g.outs.get(c.id) ?? []).some((o) => g.nodes.get(o)!.type === 'cache'));
    const caller = callers.find((c) => c.type === 'appServer' || c.type === 'worker') ?? callers[0];
    if (!cached && caller) {
      const fix: Fix = { kind: 'addSideCache', callerId: caller.id, dbId: id };
      out.push({ source: 'simulation', severity: 'warning', title: titleFor(design, fix), problem, nodeIds: [id], fix });
    }
  }

  // Co-bottlenecks: other nodes nearly as loaded at the saturation point. Fixing only the first
  // one would just move the limit a few percent, so also offer a combined fix.
  const top = flowsAtSat.nodes[id]?.utilization ?? 0;
  const co = Object.values(flowsAtSat.nodes)
    .filter((n) => n.nodeId !== id && top > 0 && Number.isFinite(n.utilization) && n.utilization >= top * 0.85)
    .sort((a, b) => b.utilization - a.utilization)
    .map((n) => n.nodeId);
  const coFixes = co.map((c) => scaleFixFor(design, flowsAtTarget, c, 0.8)).filter((x): x is Fix => !!x);
  const coLabels = co.map((c) => design.nodes.find((n) => n.id === c)?.label ?? c);
  const coNote = co.length ? ` ${coLabels.join(' and ')} ${co.length === 1 ? 'is' : 'are'} almost as loaded, so ${co.length === 1 ? 'it saturates' : 'they saturate'} right after.` : '';
  for (const c of [...out]) {
    if (!coFixes.length) break;
    const fix: Fix = { kind: 'batch', fixes: [c.fix, ...coFixes] };
    out.unshift({ ...c, title: titleFor(design, fix), problem: c.problem + coNote, nodeIds: [id, ...co], fix });
  }
  return out;
}

export function buildAdvice(design: Design, opts: AdviceOptions = {}): Advice {
  const seed = opts.seed ?? 7;
  const maxCandidates = opts.maxCandidates ?? 6;
  const baseline = measure(design, seed);

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (c: Candidate) => {
    const k = fixKey(c.fix);
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(c);
  };
  for (const c of bottleneckCandidates(design, baseline)) add(c);
  for (const f of lint(design)) {
    if (!f.autoFix) continue;
    add({ source: 'lint', severity: f.severity, title: titleFor(design, f.autoFix), problem: `${f.title}: ${f.message}`, nodeIds: f.nodeIds, fix: f.autoFix });
  }

  const configuredRps = design.workload.rps;
  const recommendations: Recommendation[] = candidates.slice(0, maxCandidates).map((c, i) => {
    const after = measure(applyFix(design, c.fix), seed);
    const speedup =
      Number.isFinite(baseline.saturationRps) && baseline.saturationRps > 0 && Number.isFinite(after.saturationRps)
        ? after.saturationRps / baseline.saturationRps
        : 1;
    const rec = { id: `rec-${i}`, ...c, action: describeFix(design, c.fix), after, speedup };
    return { ...rec, explanation: templateExplainer.explain({ design, baseline, configuredRps, rec }) as string };
  });

  // Measured throughput gains first (biggest first), then resilience fixes by severity.
  const sevRank = { error: 0, warning: 1, info: 2 };
  recommendations.sort((a, b) => {
    const ga = a.speedup > 1.05 ? 1 : 0;
    const gb = b.speedup > 1.05 ? 1 : 0;
    if (ga !== gb) return gb - ga;
    if (ga) return b.speedup - a.speedup;
    return sevRank[a.severity] - sevRank[b.severity];
  });
  // A simulation fix that gains nothing on its own is noise once a combined fix that does gain exists.
  const anyGain = recommendations.some((r) => r.speedup > 1.05);
  const kept = recommendations.filter((r) => !(anyGain && r.source === 'simulation' && r.speedup <= 1.05));
  return { baseline, configuredRps, recommendations: kept };
}
