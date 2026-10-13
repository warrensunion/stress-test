import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { fmt } from '../engine/estimator';
import type { DesignNode } from '../engine/types';
import { pct, SEVERITY_STYLE, TYPE_STYLE, utilColor } from './theme';

export type Severity = 'error' | 'warning' | 'info';

export interface NodeDecor {
  issues: { severity: Severity; message: string }[];
  util?: number;
  dead?: boolean;
  isBottleneck?: boolean;
  rps?: number;
}

export interface SystemNodeData extends NodeDecor, Record<string, unknown> {
  dn: DesignNode;
}

export type SystemFlowNode = Node<SystemNodeData, 'system'>;

function SystemNodeImpl({ data, selected }: NodeProps<SystemFlowNode>) {
  const { dn, issues, util, dead, isBottleneck, rps } = data;
  const style = TYPE_STYLE[dn.type];
  const p = dn.params;
  const worst = issues.find((i) => i.severity === 'error') ?? issues.find((i) => i.severity === 'warning') ?? issues[0];
  const details: string[] = [];
  if (dn.type === 'client') details.push(`${fmt(rps ?? 0)} req/s`);
  else details.push(`${p.instances}× ${fmt(p.capacity)}/s`, `${p.latencyMs}ms`);
  if (p.hitRate !== undefined) details.push(`hit ${Math.round(p.hitRate * 100)}%`);
  if (p.replicas !== undefined) details.push(`${p.replicas} replica${p.replicas === 1 ? '' : 's'}`);
  if (p.consumerRate !== undefined) details.push(`drain ${fmt(p.consumerRate)}/s`);

  return (
    <div
      data-testid={`node-${dn.id}`}
      className={`relative min-w-[150px] rounded-lg border-2 bg-white px-3 py-2 text-xs shadow-sm ${
        selected ? 'ring-2 ring-indigo-400' : ''
      } ${dead ? 'opacity-50' : ''}`}
      style={{ borderColor: isBottleneck ? '#dc2626' : style.color }}
    >
      {dn.type !== 'client' && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-slate-400" />}
      <div className="flex items-center gap-2">
        <span className="rounded px-1 text-[10px] font-bold text-white" style={{ background: style.color }}>
          {style.abbr}
        </span>
        <span className="truncate font-semibold text-slate-800">{dn.label}</span>
      </div>
      <div className="mt-1 text-slate-500">{details.join(' · ')}</div>
      {util !== undefined && dn.type !== 'client' && (
        <div className="mt-1">
          <div className="h-1.5 w-full rounded bg-slate-100">
            <div
              className="h-1.5 rounded"
              style={{ width: `${Math.min(100, (Number.isFinite(util) ? util : 1) * 100)}%`, background: utilColor(util) }}
            />
          </div>
          <div className="text-[10px] text-slate-500">util {pct(util)}</div>
        </div>
      )}
      {dead && <div className="mt-1 font-bold text-red-600">KILLED</div>}
      {isBottleneck && <div className="mt-1 font-bold text-red-600">BOTTLENECK</div>}
      {worst && (
        <div
          title={issues.map((i) => i.message).join('\n')}
          className={`absolute -right-2 -top-3 rounded-full border px-1.5 text-[10px] font-bold ${SEVERITY_STYLE[worst.severity]}`}
          data-testid={`node-issue-${dn.id}`}
        >
          {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-slate-400" />
    </div>
  );
}

export const SystemNode = memo(SystemNodeImpl);
