import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt } from '../engine/estimator';
import type { ChaosEvent, SimResult } from '../engine/sim/simulation';
import { SERIES_COLORS } from './theme';

const chaosLabel = (e: ChaosEvent) =>
  e.kind === 'spike' ? `spike ×${e.factor}` : e.kind === 'latency' ? `+${e.addMs}ms` : e.kind;

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-2">
      <h3 className="mb-1 text-xs font-medium text-slate-600">{title}</h3>
      <div className="h-44">
        <ResponsiveContainer>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </div>
  );
}

const axisProps = { tick: { fontSize: 10, fill: '#64748b' }, stroke: '#cbd5e1' };

function chaosLines(result: SimResult) {
  return result.chaosLog.map((e, i) => (
    <ReferenceLine
      key={i}
      x={Math.round(e.atSec * 2) / 2}
      stroke="#dc2626"
      strokeDasharray="4 3"
      label={{ value: chaosLabel(e), fontSize: 10, fill: '#b91c1c', position: 'insideTopLeft' }}
    />
  ));
}

export function SimCharts({ result }: { result: SimResult }) {
  const nodes = Object.values(result.nodes);
  // Color follows the node (design order), not its rank in the chart.
  const colorOf = new Map(nodes.map((n, i) => [n.id, SERIES_COLORS[i % SERIES_COLORS.length]]));
  // Queue chart: at most 8 series (validated palette size) — the nodes that queued the most.
  const queued = nodes
    .filter((n) => n.maxQueue > 0)
    .sort((a, b) => b.maxQueue - a.maxQueue)
    .slice(0, SERIES_COLORS.length);
  const data = result.series.map((p) => ({
    t: p.t,
    p50: +p.p50.toFixed(1),
    p99: +p.p99.toFixed(1),
    offered: Math.round(p.offeredRps),
    ok: Math.round(p.throughputRps),
    errors: Math.round(p.errorRps),
    ...Object.fromEntries(queued.map((n) => [`q_${n.id}`, p.queues[n.id] ?? 0])),
  }));
  const xAxis = <XAxis dataKey="t" type="number" domain={[0, result.durationSec]} unit="s" {...axisProps} />;

  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-3" data-testid="sim-charts">
      <Frame title="End-to-end latency (ms)">
        <LineChart data={data}>
          <CartesianGrid stroke="#f1f5f9" />
          {xAxis}
          <YAxis {...axisProps} width={40} tickFormatter={fmt} />
          <Tooltip formatter={(v: number) => `${fmt(v)} ms`} labelFormatter={(t) => `t = ${t}s`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {chaosLines(result)}
          <Line dataKey="p50" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="p99" stroke={SERIES_COLORS[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </Frame>
      <Frame title="Traffic (req/s)">
        <LineChart data={data}>
          <CartesianGrid stroke="#f1f5f9" />
          {xAxis}
          <YAxis {...axisProps} width={40} tickFormatter={fmt} />
          <Tooltip formatter={(v: number) => `${fmt(v)} req/s`} labelFormatter={(t) => `t = ${t}s`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {chaosLines(result)}
          <Line dataKey="offered" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="ok" name="succeeded" stroke={SERIES_COLORS[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="errors" stroke={SERIES_COLORS[7]} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </Frame>
      <Frame title="Queue depth (waiting requests)">
        <LineChart data={data}>
          <CartesianGrid stroke="#f1f5f9" />
          {xAxis}
          <YAxis {...axisProps} width={40} tickFormatter={fmt} />
          <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={(t) => `t = ${t}s`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {chaosLines(result)}
          {queued.map((n) => (
            <Line
              key={n.id}
              dataKey={`q_${n.id}`}
              name={n.label}
              stroke={colorOf.get(n.id)}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </Frame>
    </div>
  );
}
