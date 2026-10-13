import type { Fix } from '../fixes';
import type { Severity } from '../lint';

export interface Measurement {
  /** Simulated saturation point (req/s). Infinity if nothing carries load. */
  saturationRps: number;
  bottleneckNodeId: string | null;
  /** At the design's configured workload. */
  p99Ms: number;
  errorRate: number;
}

export interface Recommendation {
  id: string;
  /** Where the advice came from. */
  source: 'simulation' | 'lint';
  severity: Severity;
  title: string;
  /** What's wrong, in one sentence with numbers. */
  problem: string;
  /** What to change, e.g. "Set Postgres read replicas: 0 → 2". */
  action: string;
  nodeIds: string[];
  fix: Fix;
  /** Result of re-simulating the design with the fix applied. */
  after: Measurement;
  /** after.saturationRps / baseline.saturationRps */
  speedup: number;
  /** Filled in by an Explainer (template by default). */
  explanation: string;
}

export interface Advice {
  baseline: Measurement;
  configuredRps: number;
  recommendations: Recommendation[];
}
