import type { SaturationResult } from '../engine/sim/saturation';
import type { ChaosAction, SimConfig, SimResult } from '../engine/sim/simulation';
import type { Design } from '../engine/types';

export type ToWorker =
  | { type: 'run'; runId: number; design: Design; config: Partial<SimConfig>; live: boolean; speed: number }
  | { type: 'chaos'; runId: number; action: ChaosAction }
  | { type: 'stop'; runId: number };

export type FromWorker =
  | { type: 'progress'; runId: number; result: SimResult }
  | { type: 'done'; runId: number; result: SimResult }
  | { type: 'saturation'; runId: number; saturation: SaturationResult }
  | { type: 'error'; runId: number; message: string };
