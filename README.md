# Stress Test

A systems design tool that gives **advice backed by simulation, not vibes**. You sketch an architecture, and Stress Test pushes simulated traffic through it. It finds the first component to saturate and the load where that happens. It suggests fixes, re-simulates each one, and only then shows you the numbers.

- **Estimator**: back-of-the-envelope QPS, storage, bandwidth and cache size, with every formula shown.
- **Design canvas**: drag-and-drop architecture editor (React Flow), with JSON import and export.
- **Simulator**: seeded discrete-event simulation in a Web Worker. Reports per-node utilization, queue depth over time, p50/p95/p99, error and drop rate, the first bottleneck and the saturation point.
- **Chaos mode**: kill a node or one instance, add latency, or spike traffic 10×, live or scheduled mid-run. A "what broke" card summarizes the impact.
- **Linter**: 17 rules. Each finding has a severity, a message, a "why this matters" note, a suggested fix and, where possible, a one-click fix.
- **Advice loop**: combines the simulated bottleneck with lint findings into concrete recommendations. Each one is re-simulated before display, and you can apply it with **Apply suggestion & re-simulate**.
- **Presets**: URL shortener, Twitter-style feed, and a deliberately bad design.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest unit tests (engine, linter, advice, presets)
npm run e2e          # Playwright smoke test (starts its own dev server on :5287)
npm run typecheck && npm run lint
npm run build
npm run report:mm1   # re-generate the M/M/1 validation table below
```

### 60-second demo

1. Pick **Load preset… → Deliberately bad design**. Badges appear on the nodes, and the **Issues** tab lists 10 findings: SPOF database, no load balancer, single instances, a 5-hop sync chain, a queue with no workers, 300 KB objects with no CDN, and a DB over capacity.
2. Click **Run simulation**. The bottleneck tile shows **The One Database (100% busy, saturated)**. About 24% of requests are dropped, p99 is above 1 s, and the system saturates at about 860 req/s against a configured 1,200 req/s.
3. Open **Advice → Analyze & get advice**. The top suggestion caches reads in front of the DB, and its re-simulated saturation point more than doubles, to about 1,900 req/s. At that point the two single-instance web servers become the next limit. Click **Apply suggestion & re-simulate**. The applied log shows the before → after saturation point from a fresh simulation, and the analysis re-runs for the next step.
4. Try **Chaos → Kill node** on a database, or **Spike traffic 10×**. The charts get a marker and the "What broke" card explains the impact.

## Architecture

```
src/
  engine/            Pure TypeScript, no React. Runs in the worker, in tests, or on a server.
    types.ts         Design JSON schema (nodes, edges, workload)
    components.ts    Component catalog: defaults, type-specific params
    schema.ts        parse/validate/normalize untrusted JSON, serialize
    designOps.ts     Immutable edit operations (add/remove node/edge, update params)
    estimator.ts     Capacity estimator (formulas + substituted values)
    graph.ts         Adjacency helpers
    routing.ts       Routing rules shared by the simulator and the analytic model
    flow.ts          Analytic expected-rate model → utilization & saturation estimate
    sim/
      simulation.ts  Discrete-event simulator (Simulation class, simulate())
      structures.ts  Event heap, deque, percentiles
      saturation.ts  Simulation-backed saturation search (bisection)
      chaosImpact.ts "What broke" before/after analysis
    lint/            Rule engine (rules.ts = the catalog, index.ts = runner)
    fixes.ts         Machine-applicable fixes (Fix → Design transform) + scaling helper
    advice/          Advice loop (advise.ts), Explainer interface (explainer.ts)
  worker/            Web Worker wrapper around the engine + message protocol
  hooks/             useSimulator: talks to the worker
  components/        React UI (canvas, inspector, panels, charts)
  presets/           Demo designs
tests/               Vitest unit tests for the engine
e2e/                 Playwright smoke test
```

The **design JSON is the single source of truth**. The canvas renders it, the inspector edits it, and lint, simulation and advice all take it as input. ESLint enforces that `src/engine` imports nothing from React, React Flow or Recharts.

Long work runs in a Web Worker (`src/worker/sim.worker.ts`), so the UI stays responsive: simulation runs, live runs advanced in 100 ms slices, saturation searches and advice analysis. Live chaos actions are messages injected between slices.

### Design JSON

```jsonc
{
  "version": 1,
  "name": "My design",
  "workload": { "rps": 2000, "readRatio": 0.9, "objectSizeKb": 5 },
  "nodes": [
    { "id": "db", "type": "sqlDb", "label": "Postgres", "position": { "x": 600, "y": 100 },
      "params": { "capacity": 1500, "latencyMs": 5, "instances": 1, "replicas": 1 } }
  ],
  "edges": [{ "id": "e1", "source": "app", "target": "db" }]
}
```

`type` is one of `client | loadBalancer | appServer | cache | sqlDb | queue | worker | cdn`. Common params are `capacity` (req/s per instance), `latencyMs` and `instances`. Type-specific params are `hitRate` (cache, CDN), `replicas` (SQL DB) and `consumerRate` (queue). Optionally, `maxQueue` caps a node's waiting line. Missing params are filled from the component defaults on import.

## Simulation model

Discrete-event simulation with a binary-heap event queue. The RNG is seeded (mulberry32), and ties are broken by insertion order, so **the same design + seed gives the identical result**.

- **Traffic**: clients generate a Poisson stream at `workload.rps` (× spike factor), split evenly across client nodes. Each request is a read with probability `readRatio`, otherwise a write.
- **Nodes**: each node is a FIFO queue in front of a pool of `instances` identical servers (**M/M/c**).
  - Service time is exponential with mean `1/capacity`.
  - After service, the request incurs the node's fixed `latencyMs`. This is a non-blocking delay for network and baseline work, so it adds latency but not load.
- **Routing**: the rules live in `routing.ts`, and a request goes to exactly one next hop:
  - Writes go to a message queue if one is attached. Otherwise they skip caches and CDNs, unless the cache is the only path (an in-line cache).
  - Reads go to a cache or CDN if one is attached.
  - On a miss, a cache with no outgoing edges (a *side cache*) falls back to the caller's other targets. This is cache-aside.
  - With several candidates, one is picked uniformly at random. Load balancers skip dead targets because they health-check. Other nodes don't, so a dead downstream turns into errors.
- **Caches/CDNs**: a read completes with probability `hitRate`.
- **SQL DB**:
  - Two pools: primaries handle reads and writes, replicas handle reads only.
  - Each read joins the pool with the least work per server.
  - When killed, a DB with replicas loses only its primary: writes fail, reads continue.
- **Message queue**:
  - The producer is acked once the message is ingested, so sync latency ends there.
  - Messages wait in a backlog that drains at `consumerRate`, using a pull model: only to workers that have room.
  - Backlog size and enqueue-to-done lag are reported separately as async stats.
- **Failure**:
  - Queues are bounded. The default `maxQueue` is about 1 s of work (`instances × capacity`). Arrivals to a full queue are dropped.
  - Requests taking longer than 3 s end to end count as timeouts, even if they eventually finish.
  - Errors = dropped + timeouts + unavailable (dead node or no healthy target).
- **Metrics**:
  - Utilization is the busy fraction of the most-loaded pool. For queues it is the drain rate vs `consumerRate`. A queue with no consumers is ∞.
  - Latency percentiles cover completed sync requests after a 2 s warmup.
  - Time series are sampled every 0.5 s.
- **First bottleneck**: the node with the highest utilization in the run. It is *saturated* if its utilization is ≥ 95% or it dropped requests.
- **Saturation point**:
  1. The analytic model (`flow.ts`) gives a starting estimate. Utilization is linear in load, so `saturation = rps / utilization`.
  2. A bisection over short seeded simulations finds the highest load with < 1% errors and every node < 97% busy.

### Validation against M/M/1

A single server with capacity μ = 1000 req/s and zero fixed latency, arrival rate λ = ρμ, unbounded queue, 300 s runs (`npm run report:mm1`). Theory: mean time in system W = 1/(μ−λ), sojourn time ~ Exp(μ−λ) so p99 = ln(100)/(μ−λ), mean queue length Lq = ρ²/(1−ρ).

| ρ | W theory (ms) | W sim (ms) | p99 theory (ms) | p99 sim (ms) | Lq theory | Lq sim | util sim |
|---|---|---|---|---|---|---|---|
| 0.3 | 1.43 | 1.43 | 6.6 | 6.6 | 0.13 | 0.11 | 0.298 |
| 0.5 | 2.00 | 2.01 | 9.2 | 9.3 | 0.50 | 0.51 | 0.499 |
| 0.7 | 3.33 | 3.35 | 15.4 | 15.4 | 1.63 | 1.57 | 0.699 |
| 0.8 | 5.00 | 4.85 | 23.0 | 22.4 | 3.20 | 3.19 | 0.795 |
| 0.9 | 10.00 | 10.15 | 46.1 | 42.4 | 8.10 | 7.94 | 0.903 |
| 0.95 | 20.00 | 20.14 | 92.1 | 84.1 | 18.05 | 17.89 | 0.951 |

Means and queue lengths match within a few percent. Lq is sampled every 0.5 s rather than time-integrated. At high ρ the tail converges slowly, so the simulated p99 sits a little low over a finite run. `tests/simulation.test.ts` asserts this agreement (±15% on W, ±20% on p99, ±30% on Lq) for ρ = 0.5, 0.8 and 0.9. It also asserts that:
- queues grow at λ−μ when ρ > 1;
- adding replicas raises the saturation point;
- a 90% cache hit rate cuts DB load about 10×.

### Assumptions and limitations

- **Exponential service times** (M/M/c). Real services often have lower variance and heavier tails; there is no service-time distribution knob yet.
- **No fan-out**: a request follows one path. Services that call several downstreams in parallel or in sequence (scatter-gather) aren't modeled. A request touches a DB once.
- **No connection pools or thread exhaustion**: a slow downstream doesn't hold upstream workers. Cascades happen through load shift (failover), queue overflow and timeouts, not through blocked threads.
- **No retries or backoff**: a failed request is just an error, so retry storms aren't modeled.
- **Caches have a fixed hit rate**: no warm-up, eviction, or hit rate depending on size.
- **Async messages are treated as writes**, and their completion isn't included in sync latency.
- **Load is stationary Poisson** apart from chaos spikes. There are no diurnal patterns.
- **Cycles** are allowed in the graph but cut at 64 hops, and the linter flags them.
- **Bandwidth** is estimated, not simulated: object size feeds only the estimator and the CDN lint rule.

## Linter

| id | severity | catches |
|---|---|---|
| `no-client` | error | nothing generates traffic |
| `cycle` | error | requests can loop between services |
| `client-direct-db` | error | client connected straight to the DB |
| `queue-no-consumers` | error | queue with no workers |
| `queue-backlog-growth` | error | arrivals exceed drain capacity |
| `capacity-exceeded` | error | a node needs > 100% capacity at the configured load |
| `db-single-point-of-failure` | warning | one DB instance, no replica |
| `single-app-instance` | warning | app server with one instance and no sibling behind an LB |
| `multiple-app-no-lb` | warning | client/CDN fans out to app servers without a load balancer |
| `read-heavy-no-cache` | warning | ≥ 70% reads hitting a DB with no cache |
| `deep-sync-chain` | warning | > 4 synchronous hops (queues break the chain) |
| `cache-on-write-path` | warning | a cache seeing at least as many writes as reads |
| `cdn-missing-large-objects` | warning | objects ≥ 100 KB, read-heavy, no CDN |
| `high-utilization` | warning | 80–100% utilized at the configured load |
| `orphan-node` | info | unreachable from any client |
| `low-cache-hit-rate` | info | hit rate < 50% |
| `single-load-balancer` | info | LB with one instance |

Rules see the design, its graph and the **analytic flows**, so capacity rules use the same routing as the simulator.

## Advice loop

`src/engine/advice/advise.ts`:

1. **Measure**: run a saturation search, plus a 10 s run at the configured load to get p99 and error rate.
2. **Candidates**:
   - A scaling fix for the bottleneck, sized for 2× the current saturation at ≤ 80% utilization: replicas for read-bound DBs, primary capacity for write-bound DBs, instances, or consumer rate and workers.
   - A cache-aside fix for read-heavy DB bottlenecks.
   - *Combined* fixes when other nodes are within 15% of the bottleneck's load. Otherwise fixing one would just move the limit.
   - Every lint auto-fix.
3. **Re-simulate** each candidate and rank by measured saturation gain. Resilience-only fixes (e.g. a second LB instance) are listed after the throughput gains.
4. **Explain** with an `Explainer`. The default is template-based. The interface may be async, so an LLM explainer can be plugged in (see below); the numbers always come from the simulator.

## Extending

### Add a component type

1. Add the id to `ComponentType` and `COMPONENT_TYPES` in `src/engine/types.ts`.
2. Add a `ComponentSpec` in `src/engine/components.ts`: label, description, default params, and which extra params it exposes. If it needs a new param, add it to `NodeParams` and normalize it in `schema.ts`.
3. If it routes differently, teach `nextTargets` in `src/engine/routing.ts`. Because both the simulator and the analytic model use it, they stay consistent. For special service behavior (like the cache hit short-circuit), add a branch in `Simulation.onDone` and the matching expectation in `flow.ts`.
4. Give it a color and abbreviation in `src/components/theme.ts` (`TYPE_STYLE`). The palette, inspector and canvas pick it up automatically.
5. Add a test in `tests/simulation.test.ts`.

### Add a lint rule

Append to `RULES` in `src/engine/lint/rules.ts`:

```ts
{
  id: 'worker-single-instance',
  severity: 'warning',
  title: 'Single worker instance',
  why: 'If the only worker dies, the queue backs up and async work stops.',
  check: (ctx) =>
    ctx.design.nodes
      .filter((n) => n.type === 'worker' && n.params.instances === 1)
      .map((n) => ({
        nodeIds: [n.id],
        message: `${n.label} has one instance.`,
        fix: 'Run at least two workers.',
        autoFix: { kind: 'setParam', nodeId: n.id, param: 'instances', value: 2 }, // optional
      })),
}
```

`ctx` gives you `design`, `graph` (in/out adjacency) and `flows` (analytic per-node read/write rates, utilization and saturation rps). The finding shows up in the Issues tab and as a badge on the referenced nodes. An `autoFix` becomes an "Apply fix" button and an advice candidate. Add a test in `tests/lint.test.ts`.

### Plug in an LLM explainer

```ts
import { explainAdvice, type Explainer } from './engine/advice/explainer';

const llmExplainer: Explainer = {
  name: 'llm',
  async explain({ design, baseline, rec }) {
    // Call your model with the structured, simulated facts; ask it to explain, not to invent numbers.
    return callModel({ design, baseline, rec });
  },
};
const explained = await explainAdvice(design, advice, llmExplainer);
```

## Project docs

- [PROGRESS.md](PROGRESS.md): what's done, what's next, known issues.
- [DECISIONS.md](DECISIONS.md): ambiguities resolved during the build, and why.
