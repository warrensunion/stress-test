import { isCacheLike } from '../components';
import { buildGraph, clientsOf, type Graph } from '../graph';
import { Rng } from '../rng';
import { nextTargets } from '../routing';
import type { ComponentType, Design, DesignNode, Op } from '../types';
import { Deque, EventHeap, percentile } from './structures';

// Discrete-event simulation of request traffic through a design.
//
// Model (see README "Simulation model"):
//  - Clients generate a Poisson stream of requests (rate = workload.rps × spike factor);
//    each request is a read with probability workload.readRatio, else a write.
//  - Every node is a FIFO queue in front of a pool of `instances` servers (M/M/c). Service time
//    is exponential with mean 1/capacity. After service the request incurs the node's fixed
//    `latencyMs` (non-blocking delay) before arriving at the next hop.
//  - SQL DBs have two pools: primaries (writes + reads) and replicas (reads only). Reads join
//    the less-loaded pool.
//  - Caches/CDNs complete a read with probability hitRate; misses continue downstream.
//  - A Message Queue acks the producer once the message is ingested (sync latency ends there),
//    then holds it in a backlog that is drained at `consumerRate` to workers that have room.
//  - Queues are bounded (maxQueue); arrivals to a full queue are dropped. Requests whose
//    end-to-end latency exceeds `timeoutMs` count as timeouts (errors).
//  - Load balancers skip dead targets (health checks); other nodes don't, so a dead downstream
//    turns into errors.

export type ChaosEvent =
  | { atSec: number; kind: 'kill'; nodeId: string }
  | { atSec: number; kind: 'revive'; nodeId: string }
  | { atSec: number; kind: 'latency'; nodeId: string; addMs: number }
  | { atSec: number; kind: 'spike'; factor: number };

/** A chaos event without a time — applied "now" in a live run. */
export type ChaosAction = DistributiveOmit<ChaosEvent, 'atSec'>;

export interface SimConfig {
  durationSec: number;
  seed: number;
  /** Requests that start before this are excluded from latency/error stats and utilization. */
  warmupSec: number;
  sampleIntervalSec: number;
  timeoutMs: number;
  /** Override the design's workload.rps. */
  rps?: number;
  chaos: ChaosEvent[];
  /** Safety valve against runaway runs. */
  maxEvents: number;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  durationSec: 30,
  seed: 42,
  warmupSec: 2,
  sampleIntervalSec: 0.5,
  timeoutMs: 3000,
  chaos: [],
  maxEvents: 30_000_000,
};

export interface NodeStats {
  id: string;
  label: string;
  type: ComponentType;
  /** Busy fraction of the most-loaded server pool (or drain rate for queues). May be Infinity for undrained queues. */
  utilization: number;
  arrivals: number;
  /** Arrivals per second after warmup. */
  arrivalRate: number;
  dropped: number;
  unavailable: number;
  maxQueue: number;
  avgQueue: number;
  finalQueue: number;
}

export interface SeriesPoint {
  t: number;
  offeredRps: number;
  throughputRps: number;
  errorRps: number;
  p50: number;
  p99: number;
  queues: Record<string, number>;
  util: Record<string, number>;
}

export interface SimResult {
  durationSec: number;
  simulatedSec: number;
  rps: number;
  seed: number;
  /** Sync requests started after warmup. */
  requests: number;
  succeeded: number;
  errors: { dropped: number; timeouts: number; unavailable: number; total: number };
  errorRate: number;
  latencyMs: { p50: number; p95: number; p99: number; mean: number; max: number };
  nodes: Record<string, NodeStats>;
  series: SeriesPoint[];
  bottleneck: { nodeId: string; utilization: number; saturated: boolean } | null;
  async: { enqueued: number; processed: number; failed: number; backlog: number; p95LagMs: number };
  chaosLog: ChaosEvent[];
  eventsProcessed: number;
  truncated: boolean;
}

interface Req {
  op: Op;
  start: number;
  prev: string | null;
  async: boolean;
  hops: number;
  counted: boolean; // started after warmup
  id: number;
}

interface Pool {
  servers: number;
  busy: number;
  queue: Deque<Req>;
  meanService: number;
  maxQueue: number;
  busyTime: number;
  lastT: number;
  busyAtSample: number;
  busyAtWarmup: number;
}

interface NodeRT {
  id: string;
  node: DesignNode;
  pools: Pool[];
  dead: boolean;
  extraLatency: number; // seconds
  isLB: boolean;
  arrivals: number;
  arrivalsAtWarmup: number;
  dropped: number;
  unavailable: number;
  backlog: Deque<Req> | null; // message queues only
  drainScheduled: boolean;
  dispatched: number;
  dispatchedAtSample: number;
  dispatchedAtWarmup: number;
  maxQ: number;
  qSum: number;
  qSamples: number;
}

type Ev =
  | { t: number; seq: number; k: 'gen' }
  | { t: number; seq: number; k: 'arrive'; n: NodeRT; req: Req }
  | { t: number; seq: number; k: 'done'; n: NodeRT; pool: Pool; req: Req }
  | { t: number; seq: number; k: 'drain'; n: NodeRT }
  | { t: number; seq: number; k: 'sample' }
  | { t: number; seq: number; k: 'warmup' }
  | { t: number; seq: number; k: 'chaos'; ev: ChaosEvent };

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

const MAX_HOPS = 64;

export class Simulation {
  readonly config: SimConfig;
  private readonly g: Graph;
  private readonly rng: Rng;
  private readonly heap = new EventHeap<Ev>();
  private readonly rt = new Map<string, NodeRT>();
  private readonly clients: string[];
  private readonly readRatio: number;
  private readonly baseRps: number;
  private seq = 0;
  private reqSeq = 0;
  private clientRR = 0;
  private spike = 1;
  private nowT = 0;
  private events = 0;
  private truncated = false;

  // stats
  private requests = 0;
  private succeeded = 0;
  private dropped = 0;
  private timeouts = 0;
  private unavailable = 0;
  private latencies: number[] = [];
  private inflight = new Map<number, Req>();
  private asyncStats = { enqueued: 0, processed: 0, failed: 0 };
  private asyncLags: number[] = [];
  private series: SeriesPoint[] = [];
  private win = { offered: 0, ok: 0, err: 0, lat: [] as number[] };
  private chaosLog: ChaosEvent[] = [];

  constructor(design: Design, config: Partial<SimConfig> = {}) {
    this.config = { ...DEFAULT_SIM_CONFIG, ...config };
    this.g = buildGraph(design);
    this.rng = new Rng(this.config.seed);
    this.clients = clientsOf(design).map((c) => c.id);
    this.readRatio = design.workload.readRatio;
    this.baseRps = this.config.rps ?? design.workload.rps;

    for (const n of design.nodes) {
      const p = n.params;
      const mkPool = (servers: number): Pool => ({
        servers,
        busy: 0,
        queue: new Deque(),
        meanService: 1 / p.capacity,
        maxQueue: p.maxQueue ?? Math.max(10, Math.ceil(servers * p.capacity)),
        busyTime: 0,
        lastT: 0,
        busyAtSample: 0,
        busyAtWarmup: 0,
      });
      const pools = [mkPool(p.instances)];
      if (n.type === 'sqlDb' && (p.replicas ?? 0) > 0) pools.push(mkPool(p.replicas!));
      this.rt.set(n.id, {
        id: n.id,
        node: n,
        pools,
        dead: false,
        extraLatency: 0,
        isLB: n.type === 'loadBalancer',
        arrivals: 0,
        arrivalsAtWarmup: 0,
        dropped: 0,
        unavailable: 0,
        backlog: n.type === 'queue' ? new Deque() : null,
        drainScheduled: false,
        dispatched: 0,
        dispatchedAtSample: 0,
        dispatchedAtWarmup: 0,
        maxQ: 0,
        qSum: 0,
        qSamples: 0,
      });
    }

    if (this.clients.length && this.baseRps > 0) this.schedule({ t: this.rng.exp(1 / this.baseRps), k: 'gen' });
    this.schedule({ t: this.config.sampleIntervalSec, k: 'sample' });
    if (this.config.warmupSec > 0) this.schedule({ t: this.config.warmupSec, k: 'warmup' });
    for (const ev of this.config.chaos) this.schedule({ t: ev.atSec, k: 'chaos', ev });
  }

  get now() {
    return this.nowT;
  }

  get finished() {
    return this.nowT >= this.config.durationSec || this.truncated;
  }

  /** Process all events up to time `tSec` (capped at the configured duration). */
  runUntil(tSec: number): void {
    const end = Math.min(tSec, this.config.durationSec);
    for (;;) {
      const e = this.heap.peek();
      if (!e || e.t > end) break;
      if (++this.events > this.config.maxEvents) {
        this.truncated = true;
        break;
      }
      this.heap.pop();
      this.nowT = e.t;
      this.handle(e);
    }
    if (!this.truncated) this.nowT = end;
  }

  /** Apply a chaos action at the current simulated time (live mode). */
  inject(action: ChaosAction): void {
    this.applyChaos({ ...action, atSec: this.nowT } as ChaosEvent);
  }

  private schedule(e: DistributiveOmit<Ev, 'seq'>) {
    (e as Ev).seq = this.seq++;
    this.heap.push(e as Ev);
  }

  private handle(e: Ev) {
    switch (e.k) {
      case 'gen':
        return this.onGen(e.t);
      case 'arrive':
        return this.onArrive(e.n, e.req, e.t);
      case 'done':
        return this.onDone(e.n, e.pool, e.req, e.t);
      case 'drain':
        return this.onDrain(e.n, e.t);
      case 'sample':
        this.takeSample(e.t);
        this.schedule({ t: e.t + this.config.sampleIntervalSec, k: 'sample' });
        return;
      case 'warmup':
        for (const n of this.rt.values()) {
          for (const p of n.pools) {
            this.accountBusy(p, e.t);
            p.busyAtWarmup = p.busyTime;
          }
          n.arrivalsAtWarmup = n.arrivals;
          n.dispatchedAtWarmup = n.dispatched;
        }
        return;
      case 'chaos':
        return this.applyChaos(e.ev);
    }
  }

  private onGen(t: number) {
    const clientId = this.clients[this.clientRR++ % this.clients.length];
    const req: Req = {
      op: this.rng.next() < this.readRatio ? 'read' : 'write',
      start: t,
      prev: null,
      async: false,
      hops: 0,
      counted: t >= this.config.warmupSec,
      id: this.reqSeq++,
    };
    this.win.offered++;
    if (req.counted) {
      this.requests++;
      this.inflight.set(req.id, req);
    }
    this.forward(this.rt.get(clientId)!, req, t);
    const rate = this.baseRps * this.spike;
    if (rate > 0) this.schedule({ t: t + this.rng.exp(1 / rate), k: 'gen' });
  }

  private forward(from: NodeRT, req: Req, t: number) {
    if (++req.hops > MAX_HOPS) return this.fail(req, 'unavailable', from);
    let cands = nextTargets(this.g, from.id, req.op, req.prev);
    if (!cands.length) return this.complete(req, t);
    if (from.isLB) {
      cands = cands.filter((id) => !this.rt.get(id)!.dead);
      if (!cands.length) return this.fail(req, 'unavailable', from);
    }
    const target = cands.length === 1 ? cands[0] : this.rng.pick(cands);
    req.prev = from.id;
    this.schedule({ t, k: 'arrive', n: this.rt.get(target)!, req });
  }

  private onArrive(n: NodeRT, req: Req, t: number) {
    if (n.dead) return this.fail(req, 'unavailable', n);
    n.arrivals++;
    const pool = this.choosePool(n, req);
    if (pool.servers <= 0) return this.fail(req, 'unavailable', n);
    if (pool.busy < pool.servers) {
      this.accountBusy(pool, t);
      pool.busy++;
      this.schedule({ t: t + this.rng.exp(pool.meanService), k: 'done', n, pool, req });
    } else if (pool.queue.length < pool.maxQueue) {
      pool.queue.push(req);
    } else {
      n.dropped++;
      this.fail(req, 'dropped', n);
    }
  }

  private choosePool(n: NodeRT, req: Req): Pool {
    if (n.pools.length === 1 || req.op === 'write') return n.pools[0];
    // Reads: join the pool with the least work per server; ties go to replicas.
    let best = n.pools[0];
    let bestLoad = Infinity;
    for (const p of n.pools) {
      const load = (p.busy + p.queue.length) / p.servers;
      if (load <= bestLoad) {
        best = p;
        bestLoad = load;
      }
    }
    return best;
  }

  private onDone(n: NodeRT, pool: Pool, req: Req, t: number) {
    this.accountBusy(pool, t);
    const next = pool.queue.shift();
    if (next) this.schedule({ t: t + this.rng.exp(pool.meanService), k: 'done', n, pool, req: next });
    else pool.busy--;

    if (n.dead) return this.fail(req, 'unavailable', n);
    const leave = t + n.node.params.latencyMs / 1000 + n.extraLatency;
    const type = n.node.type;
    if (isCacheLike(type) && req.op === 'read' && this.rng.next() < (n.node.params.hitRate ?? 0)) {
      return this.complete(req, leave);
    }
    if (type === 'queue') {
      let msg = req;
      if (!req.async) {
        this.complete(req, leave); // producer gets its ack
        msg = { op: req.op, start: leave, prev: n.id, async: true, hops: 0, counted: req.counted, id: this.reqSeq++ };
        this.asyncStats.enqueued++;
      }
      n.backlog!.push(msg);
      this.ensureDrain(n, t);
      return;
    }
    this.forward(n, req, leave);
  }

  private ensureDrain(q: NodeRT, t: number) {
    const rate = q.node.params.consumerRate ?? 0;
    if (q.drainScheduled || !q.backlog!.length || rate <= 0 || !(this.g.outs.get(q.id) ?? []).length) return;
    q.drainScheduled = true;
    this.schedule({ t: t + 1 / rate, k: 'drain', n: q });
  }

  private onDrain(q: NodeRT, t: number) {
    q.drainScheduled = false;
    if (!q.dead && q.backlog!.length) {
      // Pull model: only consumers with spare room (≤ 1 waiting message per server) take work.
      const ready = (this.g.outs.get(q.id) ?? []).filter((id) => {
        const c = this.rt.get(id)!;
        return !c.dead && c.pools.some((p) => p.busy + p.queue.length < p.servers * 2);
      });
      if (ready.length) {
        const msg = q.backlog!.shift()!;
        q.dispatched++;
        msg.prev = q.id;
        msg.hops++;
        this.schedule({ t, k: 'arrive', n: this.rt.get(ready.length === 1 ? ready[0] : this.rng.pick(ready))!, req: msg });
      }
    }
    this.ensureDrain(q, t);
  }

  private complete(req: Req, t: number) {
    if (req.async) {
      this.asyncStats.processed++;
      this.asyncLags.push((t - req.start) * 1000);
      return;
    }
    // Time-series windows include warmup traffic; summary stats do not.
    const ms = (t - req.start) * 1000;
    const late = ms > this.config.timeoutMs;
    this.win.lat.push(ms);
    if (late) this.win.err++;
    else this.win.ok++;
    if (!req.counted) return;
    this.inflight.delete(req.id);
    this.latencies.push(ms);
    if (late) this.timeouts++;
    else this.succeeded++;
  }

  private fail(req: Req, reason: 'dropped' | 'unavailable', at: NodeRT) {
    if (reason === 'unavailable') at.unavailable++;
    if (req.async) {
      this.asyncStats.failed++;
      return;
    }
    this.win.err++;
    if (!req.counted) return;
    this.inflight.delete(req.id);
    if (reason === 'dropped') this.dropped++;
    else this.unavailable++;
  }

  private accountBusy(p: Pool, t: number) {
    p.busyTime += p.busy * (t - p.lastT);
    p.lastT = t;
  }

  private applyChaos(ev: ChaosEvent) {
    this.chaosLog.push(ev);
    if (ev.kind === 'spike') {
      const wasIdle = this.baseRps * this.spike <= 0;
      this.spike = ev.factor;
      if (wasIdle && this.baseRps * this.spike > 0 && this.clients.length) {
        this.schedule({ t: this.nowT + this.rng.exp(1 / (this.baseRps * this.spike)), k: 'gen' });
      }
      return;
    }
    const n = this.rt.get(ev.nodeId);
    if (!n) return;
    if (ev.kind === 'latency') n.extraLatency += ev.addMs / 1000;
    else if (ev.kind === 'revive') {
      n.dead = false;
      if (n.backlog) this.ensureDrain(n, this.nowT);
    } else if (ev.kind === 'kill') {
      n.dead = true;
      for (const p of n.pools) {
        for (let r = p.queue.shift(); r; r = p.queue.shift()) this.fail(r, 'unavailable', n);
      }
    }
  }

  private queueDepth(n: NodeRT) {
    let q = n.backlog ? n.backlog.length : 0;
    for (const p of n.pools) q += p.queue.length;
    return q;
  }

  private takeSample(t: number) {
    const dt = this.config.sampleIntervalSec;
    const queues: Record<string, number> = {};
    const util: Record<string, number> = {};
    for (const n of this.rt.values()) {
      if (n.node.type === 'client') continue;
      const q = this.queueDepth(n);
      queues[n.id] = q;
      n.maxQ = Math.max(n.maxQ, q);
      n.qSum += q;
      n.qSamples++;
      let u = 0;
      for (const p of n.pools) {
        this.accountBusy(p, t);
        if (p.servers > 0) u = Math.max(u, (p.busyTime - p.busyAtSample) / (p.servers * dt));
        p.busyAtSample = p.busyTime;
      }
      if (n.backlog) {
        const rate = n.node.params.consumerRate ?? 0;
        const drainU = rate > 0 && (this.g.outs.get(n.id) ?? []).length ? (n.dispatched - n.dispatchedAtSample) / (rate * dt) : n.backlog.length > 0 ? 1 : 0;
        u = Math.max(u, drainU);
        n.dispatchedAtSample = n.dispatched;
      }
      util[n.id] = u;
    }
    const lat = this.win.lat.sort((a, b) => a - b);
    this.series.push({
      t: +t.toFixed(3),
      offeredRps: this.win.offered / dt,
      throughputRps: this.win.ok / dt,
      errorRps: this.win.err / dt,
      p50: percentile(lat, 0.5),
      p99: percentile(lat, 0.99),
      queues,
      util,
    });
    this.win = { offered: 0, ok: 0, err: 0, lat: [] };
  }

  /** Summarize the run so far (can be called repeatedly during a live run). */
  result(): SimResult {
    const T = this.nowT;
    const span = Math.max(1e-9, T - this.config.warmupSec);
    // In-flight requests already older than the timeout count as timeouts.
    let staleInflight = 0;
    for (const r of this.inflight.values()) if ((T - r.start) * 1000 > this.config.timeoutMs) staleInflight++;
    const timeouts = this.timeouts + staleInflight;
    const errTotal = this.dropped + timeouts + this.unavailable;
    const finished = this.succeeded + errTotal;

    const sorted = Float64Array.from(this.latencies).sort();
    let sum = 0;
    for (const x of sorted) sum += x;

    const nodes: Record<string, NodeStats> = {};
    let bottleneck: SimResult['bottleneck'] = null;
    for (const n of this.rt.values()) {
      if (n.node.type === 'client') continue;
      let u = 0;
      for (const p of n.pools) {
        this.accountBusy(p, T);
        if (p.servers > 0) u = Math.max(u, (p.busyTime - p.busyAtWarmup) / (p.servers * span));
      }
      const arrivals = n.arrivals - n.arrivalsAtWarmup;
      if (n.backlog) {
        const rate = n.node.params.consumerRate ?? 0;
        const hasConsumers = (this.g.outs.get(n.id) ?? []).length > 0;
        if (rate > 0 && hasConsumers) u = Math.max(u, (n.dispatched - n.dispatchedAtWarmup) / (rate * span));
        else if (arrivals > 0) u = Infinity;
      }
      const finalQueue = this.queueDepth(n);
      const stats: NodeStats = {
        id: n.id,
        label: n.node.label,
        type: n.node.type,
        utilization: u,
        arrivals,
        arrivalRate: arrivals / span,
        dropped: n.dropped,
        unavailable: n.unavailable,
        maxQueue: Math.max(n.maxQ, finalQueue),
        avgQueue: n.qSamples ? n.qSum / n.qSamples : 0,
        finalQueue,
      };
      nodes[n.id] = stats;
      if (arrivals > 0 && (!bottleneck || u > bottleneck.utilization)) {
        bottleneck = { nodeId: n.id, utilization: u, saturated: false };
      }
    }
    if (bottleneck) {
      const b = nodes[bottleneck.nodeId];
      bottleneck.saturated = b.utilization >= 0.95 || b.dropped > 0;
    }

    const lags = Float64Array.from(this.asyncLags).sort();
    let backlog = 0;
    for (const n of this.rt.values()) if (n.backlog) backlog += n.backlog.length;

    return {
      durationSec: this.config.durationSec,
      simulatedSec: T,
      rps: this.baseRps,
      seed: this.config.seed,
      requests: this.requests,
      succeeded: this.succeeded,
      errors: { dropped: this.dropped, timeouts, unavailable: this.unavailable, total: errTotal },
      errorRate: finished ? errTotal / finished : 0,
      latencyMs: {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        mean: sorted.length ? sum / sorted.length : 0,
        max: sorted.length ? sorted[sorted.length - 1] : 0,
      },
      nodes,
      series: this.series.slice(),
      bottleneck,
      async: { ...this.asyncStats, backlog, p95LagMs: percentile(lags, 0.95) },
      chaosLog: this.chaosLog.slice(),
      eventsProcessed: this.events,
      truncated: this.truncated,
    };
  }
}

/** Run a full simulation synchronously. */
export function simulate(design: Design, config: Partial<SimConfig> = {}): SimResult {
  const sim = new Simulation(design, config);
  sim.runUntil(sim.config.durationSec);
  return sim.result();
}
