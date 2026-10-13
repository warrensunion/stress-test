# Decisions log

Ambiguities resolved without asking, simplest reasonable option chosen.

| # | Decision | Why |
|---|----------|-----|
| 1 | Workload (rps, read ratio, object size) lives at design level, not on the Client node. Multiple clients split rps evenly. | One source of truth; estimator can push its peak QPS straight into it. |
| 2 | Tailwind v3 (not v4), React 18, @xyflow/react v12, Vite 6, Vitest 3. | Stable, well-known config. |
| 3 | Edges carry no "sync/async" flag. Anything entering a Message Queue becomes async; everything else is sync. | Keeps schema small; the queue node already defines the boundary. |
| 4 | Missing params on import are filled from component defaults rather than rejected. | Friendlier import of hand-written JSON. |
| 5 | Git identity set repo-locally (user.name Warren, account email) since no global identity existed. | Needed to commit. |
| 6 | Estimator adds 'requests/user/day', 'replication factor' and 'cache hot fraction' inputs (defaults 20, 3, 0.2). | QPS can't be derived from DAU alone; the others make storage/cache formulas explicit. |
| 7 | Each node = M/M/c pool: exponential service with mean 1/capacity per instance, plus a fixed non-blocking `latencyMs` delay. | Matches queueing theory exactly for validation (M/M/1), still intuitive for users. |
| 8 | Default per-node `maxQueue` = 1 second of work (instances × capacity, min 10); overflow is dropped. Requests slower than 3 s count as timeouts. | Gives realistic drop/timeouts instead of infinite queues; tests override maxQueue to show unbounded growth. |
| 9 | Routing is rule-based by target type (writes → queue if present; reads → cache if present; side caches fall back to the caller's other targets; LB picks a random healthy target, others pick random targets without health checks). No fan-out (a request goes to exactly one next hop). | Simplest model that covers the common patterns; shared by sim and analytic model. |
| 10 | SQL DB reads join the less-loaded pool (primary vs replicas); writes only hit the primary. | Approximates a read-balancing proxy. |
| 11 | Message queue: producer is acked at ingest; backlog drains at `consumerRate` (fixed ticks) to workers that have room (pull model). Async messages are treated as writes. | Clear producer/consumer decoupling; backlog shows up as queue depth. |
| 12 | "Saturation point" = highest rps where a short seeded simulation has <1% errors and every node <97% busy, found by bisection around the analytic estimate. | Simulation-backed but cheap (≈10 short runs). |
| 13 | Advice candidates = scale fix for the simulated bottleneck (sized for 2× the current saturation at ≤80% util), a cache fix for read-heavy DB bottlenecks, combined fixes when other nodes are within 15% of the bottleneck's load, plus every lint auto-fix. Each candidate is re-simulated (saturation search + a 10 s run at configured load) before display; ranked by measured gain. | "Advice backed by simulation" — no number is shown that wasn't simulated. |
| 14 | Explanations are template-based behind an `Explainer` interface (`src/engine/advice/explainer.ts`) that may be async, so an LLM explainer can be dropped in; numbers always come from the simulator. | Spec: no LLM calls, but pluggable. |
| 15 | "Apply suggestion & re-simulate" applies the fix, runs a fresh simulation + saturation search, logs before → after, and re-analyzes for the next step. | Makes the advice a loop. |
| 16 | Chaos buttons inject immediately during a live run; otherwise they schedule the event at mid-run and re-run (deterministic, reproducible). | Works whether or not the user is watching a live run. |
| 17 | Killing a SQL DB that has replicas kills only the primary (writes fail, replicas keep serving reads). Added "kill 1 instance" alongside "kill node". | Makes replicas and instance counts matter under failure. |
| 18 | "What broke" compares the 5 s before the first chaos event with everything after it (skipping 1 s settle time): error rate, throughput, worst p99, newly saturated nodes (cascade). | Simple, explainable before/after diff. |
