import { fmt } from '../estimator';
import type { Design } from '../types';
import type { Advice, Recommendation } from './types';

/**
 * Turns a structured recommendation into prose. The default is template-based; an LLM-backed
 * explainer can implement the same interface (it may be async) and be swapped in without
 * touching the analysis — the numbers always come from the simulator, never from the model.
 */
export interface Explainer {
  readonly name: string;
  explain(input: ExplainInput): string | Promise<string>;
}

export interface ExplainInput {
  design: Design;
  baseline: Advice['baseline'];
  configuredRps: number;
  rec: Omit<Recommendation, 'explanation'>;
}

const rps = (x: number) => (Number.isFinite(x) ? `${fmt(x)} req/s` : 'no measurable limit');

export const templateExplainer: Explainer = {
  name: 'template',
  explain({ design, baseline, configuredRps, rec }) {
    const label = (id: string | null) => (id ? (design.nodes.find((n) => n.id === id)?.label ?? id) : 'nothing');
    const parts: string[] = [rec.problem];
    parts.push(`Change: ${rec.action}.`);
    const { after } = rec;
    if (Number.isFinite(baseline.saturationRps) && after.saturationRps > baseline.saturationRps * 1.05) {
      parts.push(
        `Re-simulated: the system now saturates at ${rps(after.saturationRps)} instead of ${rps(baseline.saturationRps)} (${rec.speedup.toFixed(1)}×)` +
          (after.bottleneckNodeId && after.bottleneckNodeId !== baseline.bottleneckNodeId
            ? `, and ${label(after.bottleneckNodeId)} becomes the next bottleneck.`
            : '.'),
      );
    } else if (rec.source === 'lint') {
      parts.push(`Re-simulated: the saturation point stays at about ${rps(after.saturationRps)} — this change buys resilience, not throughput.`);
    } else {
      parts.push(
        `Re-simulated: on its own this does not raise the saturation point (about ${rps(after.saturationRps)}), because ${label(after.bottleneckNodeId)} limits at the same load.`,
      );
    }
    if (baseline.errorRate > 0.01 && after.errorRate < baseline.errorRate) {
      parts.push(
        `At your configured ${rps(configuredRps)}, errors drop from ${(baseline.errorRate * 100).toFixed(1)}% to ${(after.errorRate * 100).toFixed(1)}%` +
          (after.p99Ms < baseline.p99Ms ? ` and p99 latency from ${fmt(baseline.p99Ms)} ms to ${fmt(after.p99Ms)} ms.` : '.'),
      );
    } else if (after.p99Ms < baseline.p99Ms * 0.8) {
      parts.push(`At your configured load, p99 latency improves from ${fmt(baseline.p99Ms)} ms to ${fmt(after.p99Ms)} ms.`);
    }
    return parts.join(' ');
  },
};

export async function explainAdvice(design: Design, advice: Advice, explainer: Explainer = templateExplainer): Promise<Advice> {
  const recommendations = await Promise.all(
    advice.recommendations.map(async (rec) => ({
      ...rec,
      explanation: await explainer.explain({ design, baseline: advice.baseline, configuredRps: advice.configuredRps, rec }),
    })),
  );
  return { ...advice, recommendations };
}
