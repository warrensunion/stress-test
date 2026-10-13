import { useCallback, useEffect, useRef, useState } from 'react';
import type { Advice } from '../engine/advice/types';
import type { SaturationResult } from '../engine/sim/saturation';
import type { ChaosAction, SimConfig, SimResult } from '../engine/sim/simulation';
import type { Design } from '../engine/types';
import type { FromWorker, ToWorker } from '../worker/protocol';

export interface RunOptions {
  config: Partial<SimConfig>;
  live: boolean;
  speed: number;
}

export interface SimulatorState {
  result: SimResult | null;
  saturation: SaturationResult | null;
  running: boolean;
  analyzing: boolean;
  error: string | null;
  /** The design the current result belongs to. */
  design: Design | null;
  advice: Advice | null;
  advising: boolean;
  adviceDesign: Design | null;
}

const ADVICE_ID_BASE = 1_000_000; // keeps advice request ids distinct from run ids

export function useSimulator() {
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const adviceIdRef = useRef(ADVICE_ID_BASE);
  const [state, setState] = useState<SimulatorState>({
    result: null,
    saturation: null,
    running: false,
    analyzing: false,
    error: null,
    design: null,
    advice: null,
    advising: false,
    adviceDesign: null,
  });

  useEffect(() => {
    const w = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.runId >= ADVICE_ID_BASE) {
        if (m.runId !== adviceIdRef.current) return;
        setState((s) =>
          m.type === 'advice'
            ? { ...s, advice: m.advice, advising: false }
            : m.type === 'error'
              ? { ...s, error: m.message, advising: false }
              : s,
        );
        return;
      }
      if (m.runId !== runIdRef.current) return; // stale
      setState((s) => {
        switch (m.type) {
          case 'progress':
            return { ...s, result: m.result };
          case 'done':
            return { ...s, result: m.result, running: false, analyzing: true };
          case 'saturation':
            return { ...s, saturation: m.saturation, analyzing: false };
          case 'error':
            return { ...s, error: m.message, running: false, analyzing: false };
          default:
            return s;
        }
      });
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  const send = (m: ToWorker) => workerRef.current?.postMessage(m);

  const run = useCallback((design: Design, opts: RunOptions) => {
    const runId = ++runIdRef.current;
    setState((s) => ({ ...s, result: null, saturation: null, running: true, analyzing: false, error: null, design }));
    send({ type: 'run', runId, design, config: opts.config, live: opts.live, speed: opts.speed });
  }, []);

  const advise = useCallback((design: Design, seed: number) => {
    const runId = ++adviceIdRef.current;
    setState((s) => ({ ...s, advising: true, adviceDesign: design, error: null }));
    send({ type: 'advise', runId, design, seed });
  }, []);

  const inject = useCallback((action: ChaosAction) => send({ type: 'chaos', runId: runIdRef.current, action }), []);
  const stop = useCallback(() => send({ type: 'stop', runId: runIdRef.current }), []);

  return { ...state, run, advise, inject, stop };
}
