import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DEFAULT_ESTIMATOR_INPUT, bytes, estimate, fmt, type EstimatorInput } from '../engine/estimator';

interface Field {
  key: keyof EstimatorInput;
  label: string;
  step?: number;
  hint?: string;
}

const FIELDS: Field[] = [
  { key: 'dau', label: 'Daily active users', step: 100000 },
  { key: 'requestsPerUserPerDay', label: 'Requests / user / day', step: 1 },
  { key: 'readWriteRatio', label: 'Read : write ratio (R:1)', step: 1, hint: '10 = ten reads per write' },
  { key: 'avgObjectSizeKb', label: 'Avg object size (KB)', step: 1 },
  { key: 'retentionYears', label: 'Retention (years)', step: 1 },
  { key: 'peakMultiplier', label: 'Peak multiplier', step: 0.5 },
  { key: 'replicationFactor', label: 'Replication factor', step: 1 },
  { key: 'cacheHotFraction', label: 'Cache hot fraction', step: 0.05, hint: '0.2 = 80/20 rule' },
];

const fmtValue = (value: number, unit: string) =>
  unit === 'bytes' ? bytes(value) : unit === 'bytes/s' ? `${bytes(value)}/s` : `${fmt(value)} ${unit}`;

export function Estimator({ onApply }: { onApply: (w: { rps: number; readRatio: number; objectSizeKb: number }) => void }) {
  const [input, setInput] = useState<EstimatorInput>(DEFAULT_ESTIMATOR_INPUT);
  const out = useMemo(() => estimate(input), [input]);
  const peak = out.metrics.find((m) => m.key === 'peakQps')!.value;
  const chartData = out.storageByYear.map((y) => ({
    year: `Y${y.year}`,
    raw: +(y.bytes / 1024 ** 4).toFixed(3),
    replicated: +(y.replicatedBytes / 1024 ** 4).toFixed(3),
  }));

  return (
    <div className="flex h-full gap-6 overflow-auto p-6" data-testid="estimator">
      <section className="w-80 shrink-0 space-y-3">
        <h2 className="text-lg font-semibold">Requirements</h2>
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="text-slate-600">{f.label}</span>
            <input
              type="number"
              min={0}
              step={f.step}
              value={input[f.key]}
              onChange={(e) => setInput({ ...input, [f.key]: Number(e.target.value) })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
            />
            {f.hint && <span className="text-xs text-slate-400">{f.hint}</span>}
          </label>
        ))}
        <button
          className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          onClick={() =>
            onApply({ rps: Math.round(peak), readRatio: out.readFraction, objectSizeKb: input.avgObjectSizeKb })
          }
        >
          Use peak QPS ({fmt(peak)}/s) as design workload
        </button>
      </section>
      <section className="min-w-0 flex-1 space-y-4">
        <h2 className="text-lg font-semibold">Estimates</h2>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {out.metrics.map((m) => (
            <div key={m.key} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-600">{m.label}</span>
                <span className="text-lg font-semibold tabular-nums" data-testid={`est-${m.key}`}>
                  {fmtValue(m.value, m.unit)}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-slate-500">{m.formula}</div>
              <div className="font-mono text-xs text-slate-400">{m.substituted}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <h3 className="mb-2 text-sm font-medium text-slate-600">Cumulative storage (TB)</h3>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="raw" fill="#6366f1" />
                <Bar dataKey="replicated" fill="#a5b4fc" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </div>
  );
}
