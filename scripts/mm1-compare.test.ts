// Prints the M/M/1 validation table used in the README:  npm run report:mm1
import { it } from 'vitest';
import { simulate } from '../src/engine/sim/simulation';
import { mm1 } from '../tests/helpers';

it('M/M/1 comparison', () => {
  const mu = 1000;
  const rows = ['| ρ | W theory (ms) | W sim (ms) | p99 theory (ms) | p99 sim (ms) | Lq theory | Lq sim | util sim |', '|---|---|---|---|---|---|---|---|'];
  for (const rho of [0.3, 0.5, 0.7, 0.8, 0.9, 0.95]) {
    const lambda = rho * mu;
    const r = simulate(mm1(lambda, mu, 1e9), { durationSec: 300, warmupSec: 10, seed: 1 });
    const W = 1000 / (mu - lambda);
    const p99 = (Math.log(100) * 1000) / (mu - lambda);
    const Lq = (rho * rho) / (1 - rho);
    rows.push(`| ${rho} | ${W.toFixed(2)} | ${r.latencyMs.mean.toFixed(2)} | ${p99.toFixed(1)} | ${r.latencyMs.p99.toFixed(1)} | ${Lq.toFixed(2)} | ${r.nodes.s.avgQueue.toFixed(2)} | ${r.nodes.s.utilization.toFixed(3)} |`);
  }
  console.log(rows.join('\n'));
});
