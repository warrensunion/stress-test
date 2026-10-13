import type { Fix } from '../fixes';
import type { FlowResult } from '../flow';
import type { Graph } from '../graph';
import type { Design } from '../types';

export type Severity = 'error' | 'warning' | 'info';

export interface LintContext {
  design: Design;
  graph: Graph;
  /** Analytic flows at the design's configured workload. */
  flows: FlowResult;
}

/** One problem found by a rule. */
export interface RuleHit {
  nodeIds: string[];
  message: string;
  /** Human-readable suggested fix. */
  fix: string;
  /** Optional machine-applicable fix. */
  autoFix?: Fix;
}

export interface LintRule {
  id: string;
  severity: Severity;
  title: string;
  /** Why this matters — shown alongside every finding. */
  why: string;
  check(ctx: LintContext): RuleHit[];
}

export interface Finding extends RuleHit {
  ruleId: string;
  severity: Severity;
  title: string;
  why: string;
}
