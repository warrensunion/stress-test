import { useState } from 'react';
import { fmt } from '../engine/estimator';
import type { ChaosAction, ChaosEvent } from '../engine/sim/simulation';
import type { Design } from '../engine/types';
import type { useSimulator } from '../hooks/useSimulator';
import { SimCharts } from './SimCharts';
import { pct, utilColor } from './theme';

export interface RunSettings {
  durationSec: number;
  seed: number;
  speed: number;
}

type Sim = ReturnType<typeof useSimulator>;

function Tile({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: 'bad' | 'ok'; testId?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === 'bad' ? 'text-red-700' : 'text-slate-800'}`} data-testid={testId}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function SimPanel({
  design,
  sim,
  settings,
  onSettings,
  onRun,
  scheduled,
  onScheduled,
  stale,
}: {
  design: Design;
  sim: Sim;
  settings: RunSettings;
  onSettings: (s: RunSettings) => void;
  onRun: (live: boolean, chaos: ChaosEvent[]) => void;
  scheduled: ChaosEvent[];
  onScheduled: (c: ChaosEvent[]) => void;
  stale: boolean;
}) {
  const targets = design.nodes.filter((n) => n.type !== 'client');
  const [chaosNode, setChaosNode] = useState<string>('');
  const nodeId = targets.some((n) => n.id === chaosNode) ? chaosNode : (targets[0]?.id ?? '');
  const r = sim.result;
  const live = sim.running;
  const label = (id: string | null | undefined) => design.nodes.find((n) => n.id === id)?.label ?? id ?? '—';

  // Chaos buttons: inject immediately into a live run, otherwise schedule mid-run and re-run.
  const chaos = (action: ChaosAction) => {
    if (live) return sim.inject(action);
    const next = [...scheduled, { ...action, atSec: settings.durationSec / 2 } as ChaosEvent];
    onScheduled(next);
    onRun(false, next);
  };

  const sat = sim.saturation;
  const bottleneck = r?.bottleneck;

  return (
    <div className="space-y-2 p-3" data-testid="sim-panel">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          onClick={() => onRun(false, scheduled)}
          disabled={live}
          data-testid="run-sim"
        >
          Run simulation
        </button>
        <button
          className="rounded border border-indigo-300 px-3 py-1.5 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          onClick={() => onRun(true, scheduled)}
          disabled={live}
          title="Watch the run unfold and inject chaos while it runs"
        >
          Live run
        </button>
        {live && (
          <button className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50" onClick={sim.stop}>
            Stop
          </button>
        )}
        <label className="flex items-center gap-1 text-slate-600">
          Duration
          <select
            className="rounded border border-slate-300 px-1 py-1"
            value={settings.durationSec}
            onChange={(e) => onSettings({ ...settings, durationSec: Number(e.target.value) })}
          >
            {[10, 30, 60, 120].map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          Seed
          <input
            type="number"
            className="w-16 rounded border border-slate-300 px-1 py-1"
            value={settings.seed}
            onChange={(e) => onSettings({ ...settings, seed: Number(e.target.value) || 1 })}
          />
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          Live speed
          <select
            className="rounded border border-slate-300 px-1 py-1"
            value={settings.speed}
            onChange={(e) => onSettings({ ...settings, speed: Number(e.target.value) })}
          >
            {[1, 3, 10].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        {live && r && (
          <span className="text-slate-500">
            t = {r.simulatedSec.toFixed(1)}s / {r.durationSec}s
          </span>
        )}
        {sim.analyzing && <span className="text-slate-500">Finding saturation point…</span>}
        {stale && r && !live && <span className="text-amber-700">Design changed since this run — re-run to update.</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 px-2 py-1.5 text-sm" data-testid="chaos-controls">
        <span className="font-semibold text-red-800">Chaos</span>
        <select
          className="rounded border border-slate-300 px-1 py-1"
          value={nodeId}
          onChange={(e) => setChaosNode(e.target.value)}
          data-testid="chaos-node"
        >
          {targets.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
        <button className="rounded border border-red-300 bg-white px-2 py-1 text-red-700 hover:bg-red-100" onClick={() => chaos({ kind: 'kill', nodeId })} disabled={!nodeId} data-testid="chaos-kill">
          Kill node
        </button>
        <button className="rounded border border-red-300 bg-white px-2 py-1 text-red-700 hover:bg-red-100" onClick={() => chaos({ kind: 'latency', nodeId, addMs: 200 })} disabled={!nodeId}>
          +200 ms latency
        </button>
        <button className="rounded border border-red-300 bg-white px-2 py-1 text-red-700 hover:bg-red-100" onClick={() => chaos({ kind: 'spike', factor: 10 })} data-testid="chaos-spike">
          Spike traffic 10×
        </button>
        {live && (
          <>
            <button className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100" onClick={() => sim.inject({ kind: 'revive', nodeId })}>
              Revive node
            </button>
            <button className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100" onClick={() => sim.inject({ kind: 'spike', factor: 1 })}>
              Traffic back to 1×
            </button>
          </>
        )}
        <span className="text-xs text-slate-500">
          {live ? 'Applied immediately to the live run.' : `Not running: scheduled at t=${settings.durationSec / 2}s and re-run.`}
        </span>
        {scheduled.length > 0 && !live && (
          <span className="flex items-center gap-1 text-xs">
            Scheduled:
            {scheduled.map((c, i) => (
              <span key={i} className="rounded bg-red-100 px-1.5 text-red-800">
                {c.kind === 'spike' ? `spike ×${c.factor}` : `${c.kind} ${label(c.nodeId)}`} @ {c.atSec}s
              </span>
            ))}
            <button className="text-slate-500 underline" onClick={() => onScheduled([])}>
              clear
            </button>
          </span>
        )}
      </div>

      {sim.error && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{sim.error}</div>}
      {!r && !live && <p className="text-sm text-slate-500">Run the simulation to see utilization, queues, latency percentiles and the first bottleneck.</p>}

      {r && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            <Tile label="p50 latency" value={`${fmt(r.latencyMs.p50)} ms`} testId="stat-p50" />
            <Tile label="p95 latency" value={`${fmt(r.latencyMs.p95)} ms`} />
            <Tile label="p99 latency" value={`${fmt(r.latencyMs.p99)} ms`} testId="stat-p99" />
            <Tile
              label="Error / drop rate"
              value={`${(r.errorRate * 100).toFixed(r.errorRate > 0 && r.errorRate < 0.01 ? 2 : 1)}%`}
              sub={`${fmt(r.errors.dropped)} dropped · ${fmt(r.errors.timeouts)} timeouts · ${fmt(r.errors.unavailable)} unavailable`}
              tone={r.errorRate > 0.01 ? 'bad' : 'ok'}
              testId="stat-errors"
            />
            <Tile label="Requests" value={fmt(r.requests)} sub={`${fmt(r.rps)} req/s offered`} />
            <Tile
              label="First bottleneck"
              value={bottleneck ? label(bottleneck.nodeId) : '—'}
              sub={bottleneck ? `${pct(bottleneck.utilization)} busy${bottleneck.saturated ? ' · SATURATED' : ''}` : undefined}
              tone={bottleneck?.saturated ? 'bad' : 'ok'}
              testId="stat-bottleneck"
            />
            <Tile
              label="Saturates at"
              value={sat ? (Number.isFinite(sat.rps) ? `${fmt(sat.rps)} req/s` : 'never') : sim.analyzing ? '…' : '—'}
              sub={sat?.bottleneckNodeId ? `${label(sat.bottleneckNodeId)} first (analytic ${fmt(sat.analyticRps)})` : undefined}
              testId="stat-saturation"
            />
          </div>
          {r.async.enqueued > 0 && (
            <div className="text-xs text-slate-600">
              Async: {fmt(r.async.enqueued)} enqueued · {fmt(r.async.processed)} processed · {fmt(r.async.failed)} failed · backlog{' '}
              {fmt(r.async.backlog)} · p95 queue lag {fmt(r.async.p95LagMs)} ms
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-[260px_1fr]">
            <div className="rounded-lg border border-slate-200 bg-white p-2" data-testid="util-list">
              <h3 className="mb-1 text-xs font-medium text-slate-600">Utilization per node</h3>
              {Object.values(r.nodes).map((n) => (
                <div key={n.id} className="mb-1 text-xs">
                  <div className="flex justify-between">
                    <span className="truncate">{n.label}</span>
                    <span className="tabular-nums text-slate-600">
                      {pct(n.utilization)} · {fmt(n.arrivalRate)}/s{n.dropped ? ` · ${fmt(n.dropped)} dropped` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 rounded bg-slate-100">
                    <div
                      className="h-1.5 rounded"
                      style={{ width: `${Math.min(100, (Number.isFinite(n.utilization) ? n.utilization : 1) * 100)}%`, background: utilColor(n.utilization) }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <SimCharts result={r} />
          </div>
          {r.truncated && <p className="text-xs text-amber-700">Run truncated: event limit reached. Lower traffic or duration.</p>}
        </>
      )}
    </div>
  );
}
