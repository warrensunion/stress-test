import { describeFix, type Fix } from '../engine/fixes';
import type { Finding } from '../engine/lint';
import type { Design } from '../engine/types';
import { SEVERITY_STYLE } from './theme';

export function IssuesPanel({
  design,
  findings,
  onSelectNode,
  onApplyFix,
}: {
  design: Design;
  findings: Finding[];
  onSelectNode: (id: string) => void;
  onApplyFix: (fix: Fix) => void;
}) {
  if (!findings.length) {
    return <p className="p-3 text-sm text-slate-500">No issues found. Run the simulation to stress-test it.</p>;
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const label = (id: string) => design.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="space-y-2 p-3" data-testid="issues-panel">
      <div className="flex gap-2 text-xs">
        {(['error', 'warning', 'info'] as const).map((s) => (
          <span key={s} className={`rounded border px-1.5 py-0.5 ${SEVERITY_STYLE[s]}`}>
            {counts[s]} {s}
            {counts[s] === 1 ? '' : 's'}
          </span>
        ))}
      </div>
      {findings.map((f, i) => (
        <div key={`${f.ruleId}-${i}`} className="rounded-lg border border-slate-200 p-2 text-sm" data-testid={`finding-${f.ruleId}`}>
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 rounded border px-1 text-[10px] font-bold uppercase ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
            <div className="min-w-0">
              <div className="font-medium">{f.title}</div>
              <div className="text-slate-700">{f.message}</div>
            </div>
          </div>
          <details className="mt-1 text-xs text-slate-600">
            <summary className="cursor-pointer select-none text-slate-500">Why this matters</summary>
            <p className="mt-1">{f.why}</p>
          </details>
          <div className="mt-1 text-xs">
            <span className="font-medium text-slate-700">Fix: </span>
            {f.fix}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {f.nodeIds.slice(0, 6).map((id) => (
              <button key={id} onClick={() => onSelectNode(id)} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-200">
                {label(id)}
              </button>
            ))}
            {f.autoFix && (
              <button
                onClick={() => onApplyFix(f.autoFix!)}
                title={describeFix(design, f.autoFix)}
                className="ml-auto rounded bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Apply fix
              </button>
            )}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">{f.ruleId}</div>
        </div>
      ))}
    </div>
  );
}
