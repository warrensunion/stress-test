import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdvicePanel, type AppliedRecord } from './components/AdvicePanel';
import { DesignCanvas, type NodeDecor } from './components/DesignCanvas';
import { Estimator } from './components/Estimator';
import { Inspector } from './components/Inspector';
import { IssuesPanel } from './components/IssuesPanel';
import { Palette } from './components/Palette';
import { SimPanel, type RunSettings } from './components/SimPanel';
import type { Recommendation } from './engine/advice/types';
import { addNode } from './engine/designOps';
import { applyFix, type Fix } from './engine/fixes';
import { lint } from './engine/lint';
import { parseDesign, serializeDesign } from './engine/schema';
import type { ChaosEvent } from './engine/sim/simulation';
import type { Design } from './engine/types';
import { useSimulator } from './hooks/useSimulator';
import { PRESETS } from './presets';

type View = 'design' | 'estimator';
type SideTab = 'inspector' | 'issues' | 'advice';

export default function App() {
  const [view, setView] = useState<View>('design');
  const [design, setDesign] = useState<Design>(() => PRESETS[0].build());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>('inspector');
  const [settings, setSettings] = useState<RunSettings>({ durationSec: 30, seed: 42, speed: 3 });
  const [scheduled, setScheduled] = useState<ChaosEvent[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const sim = useSimulator();

  const loadDesign = (d: Design) => {
    setDesign(d);
    setSelectedId(null);
    setScheduled([]);
    setApplied([]);
    sim.reset();
    setCanvasKey((k) => k + 1);
  };

  const runSim = (live: boolean, chaos: ChaosEvent[], d: Design = design) =>
    sim.run(d, { live, speed: settings.speed, config: { durationSec: settings.durationSec, seed: settings.seed, chaos } });

  const exportJson = () => {
    const blob = new Blob([serializeDesign(design)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${design.name.replace(/[^\w-]+/g, '_') || 'design'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      loadDesign(parseDesign(JSON.parse(await file.text())));
      setNotice(`Imported "${file.name}"`);
    } catch (err) {
      setNotice(`Import failed: ${(err as Error).message}`);
    }
  };

  const stale = sim.design !== null && sim.design !== design;

  // Advice loop: apply a recommendation, re-simulate, then re-analyze for the next step.
  const [applied, setApplied] = useState<(AppliedRecord & { design: Design })[]>([]);
  const applyRecommendation = (rec: Recommendation) => {
    if (!sim.advice) return;
    const next = applyFix(design, rec.fix);
    setDesign(next);
    setApplied((a) => [
      ...a,
      {
        title: rec.title,
        beforeRps: sim.advice!.baseline.saturationRps,
        predictedRps: rec.after.saturationRps,
        measuredRps: null,
        beforeBottleneck: sim.advice!.baseline.bottleneckNodeId,
        afterBottleneck: rec.after.bottleneckNodeId,
        design: next,
      },
    ]);
    runSim(false, [], next);
    sim.advise(next, settings.seed);
  };
  useEffect(() => {
    if (!sim.saturation || !sim.design) return;
    const sat = sim.saturation;
    setApplied((a) =>
      a.some((r) => r.design === sim.design && r.measuredRps === null)
        ? a.map((r) =>
            r.design === sim.design && r.measuredRps === null
              ? { ...r, measuredRps: sat.rps, afterBottleneck: sat.bottleneckNodeId ?? r.afterBottleneck }
              : r,
          )
        : a,
    );
  }, [sim.saturation, sim.design]);
  const findings = useMemo(() => lint(design), [design]);

  // Apply a fix; if we have simulation results, re-simulate the fixed design right away.
  const applyAndRerun = (fix: Fix) => {
    const next = applyFix(design, fix);
    setDesign(next);
    if (sim.result && !sim.running) runSim(false, scheduled, next);
  };

  // Per-node overlays on the canvas: client traffic, live utilization, dead nodes, bottleneck.
  const decor = useMemo(() => {
    const out: Record<string, Partial<NodeDecor>> = {};
    const clients = design.nodes.filter((n) => n.type === 'client');
    for (const n of design.nodes) out[n.id] = { issues: [] };
    for (const c of clients) out[c.id].rps = design.workload.rps / clients.length;
    for (const f of findings) {
      for (const id of f.nodeIds) out[id]?.issues?.push({ severity: f.severity, message: `${f.title}: ${f.message}` });
    }
    const r = sim.result;
    if (r && !stale) {
      const lastPoint = r.series[r.series.length - 1];
      const dead = new Set<string>();
      for (const e of r.chaosLog) {
        const dn = design.nodes.find((n) => n.id === (e.kind === 'spike' ? '' : e.nodeId));
        // A DB with replicas only loses its primary; show it as alive.
        if (e.kind === 'kill' && !(dn?.type === 'sqlDb' && (dn.params.replicas ?? 0) > 0)) dead.add(e.nodeId);
        if (e.kind === 'revive') dead.delete(e.nodeId);
      }
      for (const [id, s] of Object.entries(r.nodes)) {
        if (!out[id]) continue;
        out[id].util = sim.running && lastPoint ? (lastPoint.util[id] ?? 0) : s.utilization;
        out[id].dead = dead.has(id);
        out[id].isBottleneck = !sim.running && r.bottleneck?.nodeId === id && r.bottleneck.saturated;
      }
    }
    return out;
  }, [design, findings, sim.result, sim.running, stale]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="text-lg font-bold text-indigo-700">Stress Test</h1>
        <nav className="flex gap-1">
          {(['design', 'estimator'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-3 py-1 text-sm capitalize ${view === v ? 'bg-indigo-100 text-indigo-800' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {v}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {notice && <span className="text-slate-500">{notice}</span>}
          <select
            className="rounded border border-slate-300 px-2 py-1"
            value=""
            data-testid="preset-select"
            onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (p) {
                loadDesign(p.build());
                setNotice(`Loaded preset: ${p.name}`);
              }
            }}
          >
            <option value="">Load preset…</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <button className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" onClick={exportJson}>
            Export JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>
      <main className="min-h-0 flex-1">
        {view === 'estimator' ? (
          <Estimator
            onApply={(w) => {
              setDesign({ ...design, workload: w });
              setView('design');
            }}
          />
        ) : (
          <div className="flex h-full">
            <aside className="w-44 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50">
              <Palette
                onAdd={(t) => {
                  const [next, id] = addNode(design, t, { x: 100 + design.nodes.length * 30, y: 300 });
                  setDesign(next);
                  setSelectedId(id);
                }}
              />
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              <section className="min-h-[240px] flex-1">
                <ReactFlowProvider key={canvasKey}>
                  <DesignCanvas
                    design={design}
                    onChange={setDesign}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    decor={decor}
                    activeEdges={sim.running}
                  />
                </ReactFlowProvider>
              </section>
              <section className="max-h-[45%] shrink-0 overflow-y-auto border-t border-slate-200 bg-slate-50">
                <SimPanel
                  design={design}
                  sim={sim}
                  settings={settings}
                  onSettings={setSettings}
                  onRun={runSim}
                  scheduled={scheduled}
                  onScheduled={setScheduled}
                  stale={stale}
                />
              </section>
            </div>
            <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
              <div className="flex border-b border-slate-200 text-sm">
                {(['inspector', 'issues', 'advice'] as SideTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setSideTab(t)}
                    className={`flex-1 px-2 py-2 capitalize ${sideTab === t ? 'border-b-2 border-indigo-600 font-medium text-indigo-700' : 'text-slate-600'}`}
                  >
                    {t}
                    {t === 'issues' && findings.length > 0 && (
                      <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800" data-testid="issues-count">
                        {findings.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {sideTab === 'advice' && (
                  <AdvicePanel
                    design={design}
                    sim={sim}
                    onAnalyze={() => sim.advise(design, settings.seed)}
                    onApply={applyRecommendation}
                    applied={applied}
                  />
                )}
                {sideTab === 'issues' && (
                  <IssuesPanel design={design} findings={findings} onSelectNode={setSelectedId} onApplyFix={applyAndRerun} />
                )}
                {sideTab === 'inspector' && (
                  <Inspector design={design} selectedId={selectedId} onChange={setDesign} onDeselect={() => setSelectedId(null)} />
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
