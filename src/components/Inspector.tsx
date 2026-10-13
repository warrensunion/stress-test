import { COMPONENT_SPECS } from '../engine/components';
import { removeNodes, updateNode } from '../engine/designOps';
import type { Design, NodeParams } from '../engine/types';

function NumField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  testId?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        data-testid={testId}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, max !== undefined ? Math.min(max, v) : v));
        }}
        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1"
      />
    </label>
  );
}

export function Inspector({
  design,
  selectedId,
  onChange,
  onDeselect,
}: {
  design: Design;
  selectedId: string | null;
  onChange: (d: Design) => void;
  onDeselect: () => void;
}) {
  const node = design.nodes.find((n) => n.id === selectedId);

  if (!node) {
    const w = design.workload;
    const setW = (patch: Partial<Design['workload']>) => onChange({ ...design, workload: { ...w, ...patch } });
    return (
      <div className="space-y-3 p-3">
        <h2 className="text-sm font-semibold">Design &amp; workload</h2>
        <label className="block text-sm">
          <span className="text-slate-600">Name</span>
          <input
            value={design.name}
            onChange={(e) => onChange({ ...design, name: e.target.value })}
            className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <NumField label="Traffic (req/s, all clients)" value={w.rps} step={100} onChange={(rps) => setW({ rps })} testId="workload-rps" />
        <NumField
          label="Read ratio (0–1)"
          value={w.readRatio}
          step={0.05}
          max={1}
          onChange={(readRatio) => setW({ readRatio })}
        />
        <NumField label="Avg object size (KB)" value={w.objectSizeKb} step={10} onChange={(objectSizeKb) => setW({ objectSizeKb })} />
        <p className="text-xs text-slate-400">Select a node to edit its parameters.</p>
      </div>
    );
  }

  const spec = COMPONENT_SPECS[node.type];
  const p = node.params;
  const setP = (patch: Partial<NodeParams>) => onChange(updateNode(design, node.id, { params: patch }));

  return (
    <div className="space-y-3 p-3" data-testid="inspector">
      <div>
        <h2 className="text-sm font-semibold">{spec.label}</h2>
        <p className="text-xs text-slate-500">{spec.description}</p>
      </div>
      <label className="block text-sm">
        <span className="text-slate-600">Label</span>
        <input
          value={node.label}
          onChange={(e) => onChange(updateNode(design, node.id, { label: e.target.value }))}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1"
        />
      </label>
      {spec.hasCapacity && (
        <>
          <NumField label="Capacity per instance (req/s)" value={p.capacity} step={100} min={1} onChange={(capacity) => setP({ capacity })} testId="param-capacity" />
          <NumField label="Base latency (ms)" value={p.latencyMs} onChange={(latencyMs) => setP({ latencyMs })} />
          <NumField label="Instances" value={p.instances} min={1} onChange={(instances) => setP({ instances: Math.round(instances) })} testId="param-instances" />
        </>
      )}
      {spec.extraParams.includes('hitRate') && (
        <NumField label="Hit rate (0–1)" value={p.hitRate ?? 0} step={0.05} max={1} onChange={(hitRate) => setP({ hitRate })} />
      )}
      {spec.extraParams.includes('replicas') && (
        <NumField label="Read replicas" value={p.replicas ?? 0} onChange={(replicas) => setP({ replicas: Math.round(replicas) })} testId="param-replicas" />
      )}
      {spec.extraParams.includes('consumerRate') && (
        <NumField label="Consumer rate (msg/s)" value={p.consumerRate ?? 0} step={100} onChange={(consumerRate) => setP({ consumerRate })} />
      )}
      {spec.hasCapacity && (
        <NumField
          label="Max queue (0 = default, ~1s of work)"
          value={p.maxQueue ?? 0}
          step={100}
          onChange={(maxQueue) => setP({ maxQueue: maxQueue > 0 ? maxQueue : undefined })}
        />
      )}
      <button
        className="w-full rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
        onClick={() => {
          onChange(removeNodes(design, [node.id]));
          onDeselect();
        }}
      >
        Delete node
      </button>
    </div>
  );
}
