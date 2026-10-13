/** FIFO queue with O(1) amortized push/shift. */
export class Deque<T> {
  private a: (T | undefined)[] = [];
  private h = 0;
  push(x: T) {
    this.a.push(x);
  }
  shift(): T | undefined {
    if (this.h >= this.a.length) return undefined;
    const x = this.a[this.h];
    this.a[this.h++] = undefined;
    if (this.h > 1024 && this.h * 2 > this.a.length) {
      this.a = this.a.slice(this.h);
      this.h = 0;
    }
    return x;
  }
  unshift(x: T) {
    if (this.h > 0) this.a[--this.h] = x;
    else this.a.unshift(x);
  }
  get length() {
    return this.a.length - this.h;
  }
  *[Symbol.iterator]() {
    for (let i = this.h; i < this.a.length; i++) yield this.a[i] as T;
  }
}

/** Binary min-heap ordered by (t, seq) so ties resolve in insertion order — keeps runs deterministic. */
export class EventHeap<E extends { t: number; seq: number }> {
  private h: E[] = [];
  get size() {
    return this.h.length;
  }
  peek(): E | undefined {
    return this.h[0];
  }
  push(e: E) {
    const h = this.h;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(h[p], h[i])) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop(): E | undefined {
    const h = this.h;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && less(h[l], h[m])) m = l;
        if (r < h.length && less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}

const less = (a: { t: number; seq: number }, b: { t: number; seq: number }) => a.t < b.t || (a.t === b.t && a.seq < b.seq);

/** Nearest-rank percentile of an ascending-sorted array. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}
