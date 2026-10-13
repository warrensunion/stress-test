# Progress

All 10 phases are done in a basic-to-solid form. `npm install && npm run dev` works. `npm test` passes (69 Vitest tests), and `npm run e2e` passes (2 Playwright tests). Typecheck, lint and production build are clean.

## Done
- **Phase 1**: scaffold (Vite 6 + React 18 + TS + Tailwind 3 + ESLint 9 + Vitest 3), design JSON schema (`src/engine/types.ts`), component catalog, and parse/validate/serialize with tests.
- **Phase 2**: estimator (`src/engine/estimator.ts`, `src/components/Estimator.tsx`).
  - Computes QPS avg/peak, read/write split, storage by year (raw and replicated), ingress/egress bandwidth and cache size.
  - Every output shows its formula and the substituted values.
  - A "use as workload" button pushes the peak QPS into the design.
- **Phase 3**: simulation engine (`src/engine/sim/*`, `flow.ts`, `routing.ts`).
  - Seeded discrete-event simulation with M/M/c pools, caches, read replicas, and queues with pull-based workers.
  - Chaos events with live injection, plus a simulation-backed saturation search.
  - An analytic flow model shares the routing rules. Validated against M/M/1 (table in README).
- **Phase 4**: canvas (React Flow).
  - Palette drag-and-drop or double-click to add; connect and delete nodes.
  - Inspector for node params and workload; JSON import/export.
- **Phase 5**: the simulator runs in a Web Worker, in instant or live mode.
  - Result tiles: p50/p95/p99, error breakdown, first bottleneck, simulated saturation point.
  - Per-node utilization bars; charts for latency, traffic and queue depth with chaos markers.
  - Live utilization shows on canvas nodes.
- **Phase 6**: linter (`src/engine/lint/`) with 17 rules.
  - Each rule has an id, severity, message, why, and suggested fix; many have a machine-applicable `autoFix` (`src/engine/fixes.ts`).
  - Badges on canvas nodes; an Issues tab with "Apply fix".
- **Phase 7**: advice loop (`src/engine/advice/`).
  - Combines the bottleneck, co-bottlenecks and lint auto-fixes into candidates, re-simulates each, and ranks them by measured saturation gain.
  - Template explainer behind a pluggable async `Explainer` interface.
  - "Apply suggestion & re-simulate" keeps a before → after log and re-analyzes automatically.
- **Phase 8**: chaos mode.
  - Kill node, kill one instance, +200 ms latency, or spike traffic 10×. Events inject live, or are scheduled mid-run when nothing is running.
  - Revive and traffic reset during live runs.
  - A "What broke" card shows error rate, latency blowup, cascading saturation and failover behavior.
- **Phase 9**: presets in a header dropdown: starter, URL shortener, Twitter-style feed, and the deliberately bad design.
- **Phase 10**: README (architecture, simulation model, M/M/1 validation, assumptions/limitations, extension guides), Playwright smoke test (`e2e/smoke.spec.ts`), `npm run report:mm1`, and polish.

## Next (if continuing)
- **Service-time distributions**: deterministic or log-normal, besides exponential.
- **Fan-out calls**: a request hitting several downstreams.
- **Retries with backoff**: to model retry storms.
- **Connection-pool and thread exhaustion**: for more realistic cascades.
- **Undo/redo** on the canvas.
- **Code-split** Recharts and React Flow to shrink the 780 KB bundle.
- **Dark mode.**

## Known issues
- **Advice is slow on larger designs.** "Analyze & get advice" runs about 8–12 short simulations per candidate, up to 6 candidates. That takes about 5–20 s in the worker. The UI stays responsive, but there is no progress bar.
- **The live run blocks during advice analysis.** The worker handles messages one at a time, so a live run can't advance while advice is computing. The Analyze button is disabled during runs, but not the other way round.
- **No dark mode.** The UI is light only, and chart colors use the validated light palette.
- **Queue chart colors wrap above 8 nodes.** Colors are assigned by node order (8 colors), so designs with more than 8 queueing nodes can repeat a color. The legend still disambiguates.
- **Dev port fallback.** The dev server uses Vite's default port 5173 and falls back to the next free port if it's taken.

## Deferred
- none. No phase needed to be simplified past its spec.
