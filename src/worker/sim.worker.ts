/// <reference lib="webworker" />
import { buildAdvice } from '../engine/advice/advise';
import { findSaturation } from '../engine/sim/saturation';
import { Simulation } from '../engine/sim/simulation';
import type { Design } from '../engine/types';
import type { FromWorker, ToWorker } from './protocol';

// Runs simulations off the main thread. Live runs advance in small slices on a timer so chaos
// messages from the UI can be injected between slices.

const TICK_MS = 100;

let current: { runId: number; sim: Simulation; design: Design; timer?: ReturnType<typeof setTimeout> } | null = null;

const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

function finish(runId: number, sim: Simulation, design: Design) {
  post({ type: 'done', runId, result: sim.result() });
  // Saturation search is a separate, chaos-free set of short runs.
  try {
    const saturation = findSaturation(design, { seed: sim.config.seed });
    post({ type: 'saturation', runId, saturation });
  } catch (e) {
    post({ type: 'error', runId, message: `Saturation search failed: ${(e as Error).message}` });
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'run') {
      if (current?.timer) clearTimeout(current.timer);
      const sim = new Simulation(msg.design, msg.config);
      current = { runId: msg.runId, sim, design: msg.design };
      if (!msg.live) {
        sim.runUntil(sim.config.durationSec);
        current = null;
        finish(msg.runId, sim, msg.design);
        return;
      }
      const step = (msg.speed * TICK_MS) / 1000;
      const tick = () => {
        if (!current || current.runId !== msg.runId) return;
        sim.runUntil(sim.now + step);
        if (sim.finished) {
          current = null;
          finish(msg.runId, sim, msg.design);
        } else {
          post({ type: 'progress', runId: msg.runId, result: sim.result() });
          current.timer = setTimeout(tick, TICK_MS);
        }
      };
      tick();
    } else if (msg.type === 'advise') {
      post({ type: 'advice', runId: msg.runId, advice: buildAdvice(msg.design, { seed: msg.seed }) });
    } else if (msg.type === 'chaos') {
      if (current?.runId === msg.runId) current.sim.inject(msg.action);
    } else if (msg.type === 'stop') {
      if (current?.runId === msg.runId) {
        if (current.timer) clearTimeout(current.timer);
        const { sim, design } = current;
        current = null;
        finish(msg.runId, sim, design);
      }
    }
  } catch (e) {
    post({ type: 'error', runId: 'runId' in msg ? msg.runId : -1, message: (e as Error).message });
  }
};
