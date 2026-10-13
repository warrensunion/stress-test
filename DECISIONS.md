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
