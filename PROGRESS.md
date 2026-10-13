# Progress

## Done
- Phase 1: scaffold (Vite + React + TS + Tailwind + ESLint + Vitest), design JSON schema (`src/engine/types.ts`), component catalog, parse/validate/serialize with tests.
- Phase 2: estimator (`src/engine/estimator.ts`, `src/components/Estimator.tsx`) — QPS avg/peak, read/write split, storage by year, bandwidth, cache size, each with formula + substituted values; "use as workload" button.
- Phase 3: simulation engine (`src/engine/sim/*`, `src/engine/flow.ts`, `src/engine/routing.ts`) — seeded discrete-event sim with M/M/c pools, caches, replicas, queues/workers, chaos events, live injection, saturation search; analytic flow model. Tests vs. M/M/1 theory.
- Phase 4: canvas (React Flow) with palette drag-and-drop, connect/delete, inspector for node params + workload, JSON import/export.
- Phase 5: simulator runs in a Web Worker (`src/worker/sim.worker.ts`, `src/hooks/useSimulator.ts`); instant and live runs; results panel with latency percentiles, error breakdown, first bottleneck, simulated saturation point, per-node utilization, charts (latency, traffic, queue depth) with chaos markers; canvas shows live utilization.
- Phase 6: linter (`src/engine/lint/`) — 17 rules with id, severity, message, why, suggested fix and (where possible) a machine-applicable fix (`src/engine/fixes.ts`); badges on canvas nodes; Issues tab with "Apply fix" (re-simulates if results exist).

## Next
- Phase 7: advice loop.

## Known issues
- Double-click-to-add places nodes at a fixed spot that may be outside the current viewport.

## Deferred
- none yet
