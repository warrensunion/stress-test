import type { Recommendation } from '../engine/advice/types';
import { fmt } from '../engine/estimator';
import type { Design } from '../engine/types';
import type { useSimulator } from '../hooks/useSimulator';
import { SEVERITY_STYLE } from './theme';

export interface AppliedRecord {
  title: string;
  beforeRps: number;
  predictedRps: number;
  /** Filled in when the re-simulation of the fixed design finishes. */
  measuredRps: number | null;
  beforeBottleneck: string | null;
  afterBottleneck: string | null;
}

const rps = (x: number) => (Number.isFinite(x) ? `${fmt(x)} req/s` : '∞');

export function AdvicePanel({
  design,
  sim,
  onAnalyze,
  onApply,
  applied,
}: {
  design: Design;
  sim: ReturnType<typeof useSimulator>;
  onAnalyze: () => void;
  onApply: (rec: Recommendation) => void;
  applied: AppliedRecord[];
}) {
  const advice = sim.advice;
  const stale = advice && sim.adviceDesign !== design;
  const label = (id: string | null) => (id ? (design.nodes.find((n) => n.id === id)?.label ?? id) : '—');

  return (
    <div className="space-y-2 p-3" data-testid="advice-panel">
      <p className="text-xs text-slate-500">
        Combines the simulated bottleneck with linter findings. Every suggestion is re-simulated before it is shown.
      </p>
      <button
        className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        onClick={onAnalyze}
        disabled={sim.advising || sim.running}
        data-testid="get-advice"
      >
        {sim.advising ? 'Simulating candidate fixes…' : advice ? 'Re-analyze' : 'Analyze & get advice'}
      </button>

      {applied.length > 0 && (
        <div className="space-y-1 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-xs" data-testid="applied-log">
          <div className="font-semibold text-emerald-900">Applied</div>
          {applied.map((a, i) => (
            <div key={i} className="text-emerald-900">
              ✓ {a.title}: saturation {rps(a.beforeRps)} → <b>{a.measuredRps === null ? '…' : rps(a.measuredRps)}</b>
              {a.measuredRps !== null && Number.isFinite(a.beforeRps) && Number.isFinite(a.measuredRps) && a.beforeRps > 0 && (
                <> ({(a.measuredRps / a.beforeRps).toFixed(1)}×, re-simulated)</>
              )}
              {a.afterBottleneck && a.afterBottleneck !== a.beforeBottleneck && <> — next bottleneck: {label(a.afterBottleneck)}</>}
            </div>
          ))}
        </div>
      )}

      {advice && (
        <>
          {stale && <p className="text-xs text-amber-700">Design changed since this analysis — re-analyze for fresh numbers.</p>}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs" data-testid="advice-baseline">
            <div>
              <b>Current:</b> saturates at <b>{rps(advice.baseline.saturationRps)}</b>
              {advice.baseline.bottleneckNodeId && <> — first bottleneck: <b>{label(advice.baseline.bottleneckNodeId)}</b></>}
            </div>
            <div className="text-slate-600">
              At {rps(advice.configuredRps)}: p99 {fmt(advice.baseline.p99Ms)} ms · errors {(advice.baseline.errorRate * 100).toFixed(1)}%
            </div>
          </div>
          {advice.recommendations.length === 0 && <p className="text-sm text-slate-500">No improvements found.</p>}
          {advice.recommendations.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 p-2 text-sm" data-testid="recommendation">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 rounded border px-1 text-[10px] font-bold uppercase ${SEVERITY_STYLE[r.severity]}`}>
                  {r.source === 'simulation' ? 'sim' : 'lint'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-slate-600">
                    {rps(advice.baseline.saturationRps)} → <b className="text-slate-900">{rps(r.after.saturationRps)}</b>
                    {r.speedup > 1.05 ? (
                      <span className="ml-1 rounded bg-emerald-100 px-1 text-emerald-800">{r.speedup.toFixed(1)}×</span>
                    ) : (
                      <span className="ml-1 rounded bg-slate-100 px-1 text-slate-600">{r.source === 'lint' ? 'resilience' : 'no gain alone'}</span>
                    )}
                  </div>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-700">{r.explanation}</p>
              <button
                className="mt-1.5 w-full rounded border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                onClick={() => onApply(r)}
                disabled={!!stale || sim.running}
                data-testid="apply-recommendation"
              >
                Apply suggestion &amp; re-simulate
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
