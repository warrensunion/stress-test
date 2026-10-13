// Back-of-the-envelope capacity estimator. Every output carries the formula used and the
// formula with numbers substituted, so the UI can "show its work".

export interface EstimatorInput {
  dau: number;
  /** Requests each active user makes per day (reads + writes). */
  requestsPerUserPerDay: number;
  /** Reads per write, e.g. 10 means 10:1. */
  readWriteRatio: number;
  avgObjectSizeKb: number;
  retentionYears: number;
  peakMultiplier: number;
  /** Copies of each object stored (replication). */
  replicationFactor: number;
  /** Fraction of daily read volume to keep hot in cache (80/20 rule → 0.2). */
  cacheHotFraction: number;
}

export interface Estimate {
  key: string;
  label: string;
  value: number;
  unit: string;
  formula: string;
  substituted: string;
}

export interface EstimatorOutput {
  metrics: Estimate[];
  /** Cumulative storage at the end of each year (bytes), for charting. */
  storageByYear: { year: number; bytes: number; replicatedBytes: number }[];
  readFraction: number;
}

export const DEFAULT_ESTIMATOR_INPUT: EstimatorInput = {
  dau: 10_000_000,
  requestsPerUserPerDay: 20,
  readWriteRatio: 10,
  avgObjectSizeKb: 1,
  retentionYears: 5,
  peakMultiplier: 3,
  replicationFactor: 3,
  cacheHotFraction: 0.2,
};

const SECONDS_PER_DAY = 86_400;
const KB = 1024;

export function estimate(input: EstimatorInput): EstimatorOutput {
  const i = sanitize(input);
  const readFraction = i.readWriteRatio / (i.readWriteRatio + 1);
  const writeFraction = 1 - readFraction;
  const objBytes = i.avgObjectSizeKb * KB;

  const avgQps = (i.dau * i.requestsPerUserPerDay) / SECONDS_PER_DAY;
  const peakQps = avgQps * i.peakMultiplier;
  const readQps = avgQps * readFraction;
  const writeQps = avgQps * writeFraction;
  const storagePerDay = writeQps * SECONDS_PER_DAY * objBytes;
  const storagePerYear = storagePerDay * 365;
  const storageTotal = storagePerYear * i.retentionYears;
  const storageReplicated = storageTotal * i.replicationFactor;
  const ingress = writeQps * objBytes;
  const egress = readQps * objBytes;
  const peakEgress = egress * i.peakMultiplier;
  const cacheBytes = readQps * SECONDS_PER_DAY * objBytes * i.cacheHotFraction;

  const f = fmt;
  const metrics: Estimate[] = [
    {
      key: 'avgQps',
      label: 'Average QPS',
      value: avgQps,
      unit: 'req/s',
      formula: 'DAU × requests/user/day ÷ 86,400',
      substituted: `${f(i.dau)} × ${f(i.requestsPerUserPerDay)} ÷ 86,400 = ${f(avgQps)}`,
    },
    {
      key: 'peakQps',
      label: 'Peak QPS',
      value: peakQps,
      unit: 'req/s',
      formula: 'avg QPS × peak multiplier',
      substituted: `${f(avgQps)} × ${f(i.peakMultiplier)} = ${f(peakQps)}`,
    },
    {
      key: 'readQps',
      label: 'Read QPS (avg)',
      value: readQps,
      unit: 'req/s',
      formula: 'avg QPS × R ÷ (R + 1)',
      substituted: `${f(avgQps)} × ${f(i.readWriteRatio)} ÷ ${f(i.readWriteRatio + 1)} = ${f(readQps)}`,
    },
    {
      key: 'writeQps',
      label: 'Write QPS (avg)',
      value: writeQps,
      unit: 'req/s',
      formula: 'avg QPS ÷ (R + 1)',
      substituted: `${f(avgQps)} ÷ ${f(i.readWriteRatio + 1)} = ${f(writeQps)}`,
    },
    {
      key: 'storagePerYear',
      label: 'New storage / year',
      value: storagePerYear,
      unit: 'bytes',
      formula: 'write QPS × 86,400 × 365 × object size',
      substituted: `${f(writeQps)} × 86,400 × 365 × ${f(objBytes)} B = ${bytes(storagePerYear)}`,
    },
    {
      key: 'storageTotal',
      label: `Storage after ${f(i.retentionYears)} yr (raw)`,
      value: storageTotal,
      unit: 'bytes',
      formula: 'storage/year × retention years',
      substituted: `${bytes(storagePerYear)} × ${f(i.retentionYears)} = ${bytes(storageTotal)}`,
    },
    {
      key: 'storageReplicated',
      label: `Storage after ${f(i.retentionYears)} yr (replicated)`,
      value: storageReplicated,
      unit: 'bytes',
      formula: 'raw storage × replication factor',
      substituted: `${bytes(storageTotal)} × ${f(i.replicationFactor)} = ${bytes(storageReplicated)}`,
    },
    {
      key: 'ingress',
      label: 'Ingress bandwidth (avg)',
      value: ingress,
      unit: 'bytes/s',
      formula: 'write QPS × object size',
      substituted: `${f(writeQps)} × ${f(objBytes)} B = ${bytes(ingress)}/s`,
    },
    {
      key: 'egress',
      label: 'Egress bandwidth (avg)',
      value: egress,
      unit: 'bytes/s',
      formula: 'read QPS × object size',
      substituted: `${f(readQps)} × ${f(objBytes)} B = ${bytes(egress)}/s`,
    },
    {
      key: 'peakEgress',
      label: 'Egress bandwidth (peak)',
      value: peakEgress,
      unit: 'bytes/s',
      formula: 'avg egress × peak multiplier',
      substituted: `${bytes(egress)}/s × ${f(i.peakMultiplier)} = ${bytes(peakEgress)}/s`,
    },
    {
      key: 'cacheSize',
      label: 'Suggested cache size',
      value: cacheBytes,
      unit: 'bytes',
      formula: 'read QPS × 86,400 × object size × hot fraction (80/20 rule)',
      substituted: `${f(readQps)} × 86,400 × ${f(objBytes)} B × ${f(i.cacheHotFraction)} = ${bytes(cacheBytes)}`,
    },
  ];

  const storageByYear = Array.from({ length: Math.max(1, Math.ceil(i.retentionYears)) }, (_, k) => {
    const year = k + 1;
    const b = storagePerYear * Math.min(year, i.retentionYears);
    return { year, bytes: b, replicatedBytes: b * i.replicationFactor };
  });

  return { metrics, storageByYear, readFraction };
}

function sanitize(i: EstimatorInput): EstimatorInput {
  const pos = (x: number, d: number) => (Number.isFinite(x) && x >= 0 ? x : d);
  return {
    dau: pos(i.dau, 0),
    requestsPerUserPerDay: pos(i.requestsPerUserPerDay, 0),
    readWriteRatio: pos(i.readWriteRatio, 1),
    avgObjectSizeKb: pos(i.avgObjectSizeKb, 0),
    retentionYears: pos(i.retentionYears, 1),
    peakMultiplier: Math.max(1, pos(i.peakMultiplier, 1)),
    replicationFactor: Math.max(1, pos(i.replicationFactor, 1)),
    cacheHotFraction: Math.min(1, pos(i.cacheHotFraction, 0.2)),
  };
}

/** Human-readable number: 1234567 → "1.23M". */
export function fmt(x: number): string {
  if (!Number.isFinite(x)) return '∞';
  const a = Math.abs(x);
  if (a >= 1e12) return `${trim(x / 1e12)}T`;
  if (a >= 1e9) return `${trim(x / 1e9)}B`;
  if (a >= 1e6) return `${trim(x / 1e6)}M`;
  if (a >= 1e4) return `${trim(x / 1e3)}K`;
  if (a >= 100 || Number.isInteger(x)) return Math.round(x).toLocaleString('en-US');
  return trim(x);
}

/** Human-readable bytes (binary units). */
export function bytes(b: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let v = b;
  let u = 0;
  while (Math.abs(v) >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${trim(v)} ${units[u]}`;
}

const trim = (x: number) => {
  const s = Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
  return s.replace(/\.0+$|(\.\d*?)0+$/, '$1');
};
