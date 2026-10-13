import { computeFlows } from '../flow';
import { buildGraph } from '../graph';
import type { Design } from '../types';
import { RULES } from './rules';
import type { Finding, LintRule } from './types';

export type { Finding, LintRule, Severity } from './types';
export { RULES } from './rules';

const ORDER = { error: 0, warning: 1, info: 2 } as const;

/** Run every rule over a design. Findings are sorted most severe first. */
export function lint(design: Design, rules: LintRule[] = RULES): Finding[] {
  const ctx = { design, graph: buildGraph(design), flows: computeFlows(design) };
  const out: Finding[] = [];
  for (const rule of rules) {
    for (const hit of rule.check(ctx)) {
      out.push({ ...hit, ruleId: rule.id, severity: rule.severity, title: rule.title, why: rule.why });
    }
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
