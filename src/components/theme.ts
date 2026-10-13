import type { ComponentType } from '../engine/types';

export const TYPE_STYLE: Record<ComponentType, { color: string; abbr: string }> = {
  client: { color: '#64748b', abbr: 'CL' },
  loadBalancer: { color: '#0ea5e9', abbr: 'LB' },
  appServer: { color: '#6366f1', abbr: 'APP' },
  cache: { color: '#ef4444', abbr: 'C$' },
  sqlDb: { color: '#f59e0b', abbr: 'DB' },
  queue: { color: '#10b981', abbr: 'MQ' },
  worker: { color: '#14b8a6', abbr: 'WK' },
  cdn: { color: '#a855f7', abbr: 'CDN' },
};

export const SEVERITY_STYLE = {
  error: 'bg-red-100 text-red-800 border-red-300',
  warning: 'bg-amber-100 text-amber-800 border-amber-300',
  info: 'bg-sky-100 text-sky-800 border-sky-300',
} as const;

export const pct = (u: number) => (Number.isFinite(u) ? `${Math.round(u * 100)}%` : '∞');

/** Green → amber → red as utilization climbs. */
export const utilColor = (u: number) => (!Number.isFinite(u) || u >= 0.95 ? '#dc2626' : u >= 0.75 ? '#d97706' : '#16a34a');

/** Stable colors for chart series. */
// Validated categorical order (dataviz reference palette, light mode). Max 8 series; fold the rest.
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
