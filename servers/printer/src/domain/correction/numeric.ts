/**
 * The few numerical routines the correction model needs, written to give the
 * same doubles as numpy where the reference implementation used it, so a LUT
 * computed here equals one computed there (test/correction.test.ts holds them
 * to it). Where numpy's result depends on its summation order (`mean`), that
 * order is copied; where it calls LAPACK (`lstsq`), this solves the same
 * problem by Householder QR, which agrees to about 1e-13.
 */

/** Python's round(): to the nearest integer, a half to the even one. */
export const roundHalfEven = (x: number): number => {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
};

/** numpy's pairwise summation (blocks of 8 under 128 values, halves above), so a mean is the same double. */
const pairwiseSum = (a: readonly number[], start: number, n: number): number => {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i += 1) res += a[start + i] as number;
    return res;
  }
  if (n <= 128) {
    const r = a.slice(start, start + 8);
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j += 1) r[j] = (r[j] as number) + (a[start + i + j] as number);
    const [r0, r1, r2, r3, r4, r5, r6, r7] = r as [number, number, number, number, number, number, number, number];
    let res = r0 + r1 + (r2 + r3) + (r4 + r5 + (r6 + r7));
    for (; i < n; i += 1) res += a[start + i] as number;
    return res;
  }
  let half = Math.floor(n / 2);
  half -= half % 8;
  return pairwiseSum(a, start, half) + pairwiseSum(a, start + half, n - half);
};

export const mean = (a: readonly number[]): number => pairwiseSum(a, 0, a.length) / a.length;

/** The last index j with xp[j] <= x (numpy's binary_search_with_guess): -1 below the first, xp.length above the last. */
const upperIndex = (x: number, xp: readonly number[]): number => {
  const n = xp.length;
  if (x > (xp[n - 1] as number)) return n;
  if (x < (xp[0] as number)) return -1;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (x >= (xp[mid] as number)) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
};

/** numpy.interp for one point: piecewise linear through (xp, fp), clamped to the end values; xp increasing. */
export const interp = (x: number, xp: readonly number[], fp: readonly number[]): number => {
  const n = xp.length;
  const j = upperIndex(x, xp);
  if (j === -1) return fp[0] as number;
  if (j === n) return fp[n - 1] as number;
  if (j === n - 1) return fp[j] as number;
  const x0 = xp[j] as number;
  const y0 = fp[j] as number;
  if (x0 === x) return y0;
  const x1 = xp[j + 1] as number;
  const y1 = fp[j + 1] as number;
  const slope = (y1 - y0) / (x1 - x0);
  const res = slope * (x - x0) + y0;
  if (!Number.isNaN(res)) return res;
  const other = slope * (x - x1) + y1;
  return Number.isNaN(other) && y0 === y1 ? y0 : other;
};

/** numpy.maximum.accumulate. */
export const cumulativeMax = (a: readonly number[]): number[] => {
  const out: number[] = [];
  let best = -Infinity;
  for (const v of a) {
    best = Math.max(best, v);
    out.push(best);
  }
  return out;
};

/** numpy.linspace(start, stop, num) with the endpoint, as numpy computes it: i * step + start, the last set to stop. */
export const linspace = (start: number, stop: number, num: number): number[] => {
  const step = (stop - start) / (num - 1);
  const out = Array.from({ length: num }, (_, i) => i * step + start);
  out[num - 1] = stop;
  return out;
};

/** numpy.vander(z, n): the powers z^(n-1) ... z^0, each the running product as numpy accumulates it. */
export const vanderRow = (z: number, columns: number): number[] => {
  const increasing = [1];
  for (let k = 1; k < columns; k += 1) increasing.push(k === 1 ? z : (increasing[k - 1] as number) * z);
  return increasing.reverse();
};

/**
 * Least squares, min |A c - b|, by Householder QR: A is rows x cols with
 * rows >= cols and full column rank. Returns c.
 */
export const leastSquares = (a: readonly (readonly number[])[], b: readonly number[]): number[] => {
  const rows = a.length;
  const cols = a[0]?.length ?? 0;
  if (rows < cols || cols === 0) throw new RangeError(`least squares needs at least ${cols} rows, got ${rows}`);
  const m = a.map((row) => [...row]);
  const y = [...b];
  for (let k = 0; k < cols; k += 1) {
    let norm = 0;
    for (let i = k; i < rows; i += 1) norm = Math.hypot(norm, (m[i] as number[])[k] as number);
    if (norm === 0) throw new RangeError("least squares: the design matrix is rank deficient");
    const pivot = (m[k] as number[])[k] as number;
    const alpha = pivot > 0 ? -norm : norm;
    const v = Array.from({ length: rows - k }, (_, i) => (m[k + i] as number[])[k] as number);
    v[0] = (v[0] as number) - alpha;
    const vv = v.reduce((s, x) => s + x * x, 0);
    if (vv === 0) continue;
    for (let j = k; j < cols; j += 1) {
      let dot = 0;
      for (let i = 0; i < v.length; i += 1) dot += (v[i] as number) * ((m[k + i] as number[])[j] as number);
      const f = (2 * dot) / vv;
      for (let i = 0; i < v.length; i += 1) (m[k + i] as number[])[j] = ((m[k + i] as number[])[j] as number) - f * (v[i] as number);
    }
    let dot = 0;
    for (let i = 0; i < v.length; i += 1) dot += (v[i] as number) * (y[k + i] as number);
    const f = (2 * dot) / vv;
    for (let i = 0; i < v.length; i += 1) y[k + i] = (y[k + i] as number) - f * (v[i] as number);
  }
  const c = new Array<number>(cols).fill(0);
  for (let k = cols - 1; k >= 0; k -= 1) {
    let s = y[k] as number;
    for (let j = k + 1; j < cols; j += 1) s -= ((m[k] as number[])[j] as number) * (c[j] as number);
    c[k] = s / ((m[k] as number[])[k] as number);
  }
  return c;
};
