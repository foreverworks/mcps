import { interp, leastSquares, mean, vanderRow } from "./numeric.js";

/**
 * The printer, modelled from measured patches: what it prints for what it is
 * sent, and where on the page.
 *
 *     printed = R(sent) + D(x) * w(R(sent))
 *
 * - R, the tone response: monotone (isotonic regression), pinned to 0 at 0
 *   and 100 at 100. A laser printer drops light greys and comes in in steps,
 *   which no smooth curve follows.
 * - D(x), the left-right density profile across the page (x in mm from the
 *   left paper edge): a polynomial of degree 4. A printer's drum and fuser
 *   print the edges darker or a band lighter, and that profile is stable.
 * - w(c), how much of D a tone takes: all of it in mid tones, none at paper
 *   white or solid black, tapering over 20 points at each end.
 *
 * R and D are fitted jointly by alternating: R on the measurements with the
 * current D taken out, then D on what R leaves, six times.
 *
 * Coverage is in percent: 0 paper, 100 solid black.
 */

/** One measured patch: the coverage sent, where it was (mm from the left edge), and the coverage measured on paper. */
export type Point = { readonly sheet: string; readonly sent: number; readonly xMm: number; readonly printed: number };

export type Model = {
  /** R's knots: sent coverage, increasing, from 0 to 100. */
  readonly responseSent: readonly number[];
  /** R's values at those knots, non-decreasing, from 0 to 100. */
  readonly responsePrinted: readonly number[];
  /** D's polynomial in z = (x - 105) / 105, highest power first. */
  readonly lateral: readonly number[];
};

/** Where D's polynomial is centred and scaled: the middle of an A4 page's width, in mm. */
const LATERAL_CENTRE_MM = 105;
const LATERAL_DEGREE = 4;
const ITERATIONS = 6;

export const weight = (c: number): number => Math.min(1, Math.max(0, Math.min(c / 20, (100 - c) / 20)));

export const lateralAt = (lateral: readonly number[], xMm: number): number => {
  const row = vanderRow((xMm - LATERAL_CENTRE_MM) / LATERAL_CENTRE_MM, lateral.length);
  let sum = 0;
  for (let k = 0; k < row.length; k += 1) sum += (row[k] as number) * (lateral[k] as number);
  return sum;
};

type Block = { y: number; w: number; xs: number[] };

/**
 * Isotonic (non-decreasing) regression by pooling adjacent violators: points
 * in order of x (stable), each block the weighted mean of what it pooled.
 * Returns each block's mean x, value and weight.
 */
export const pava = (
  x: readonly number[],
  y: readonly number[],
  w: readonly number[],
): readonly { readonly x: number; readonly y: number; readonly w: number }[] => {
  const order = x.map((_, i) => i).sort((a, b) => (x[a] as number) - (x[b] as number) || a - b);
  const blocks: Block[] = order.map((i) => ({ y: y[i] as number, w: w[i] as number, xs: [x[i] as number] }));
  let i = 0;
  while (i < blocks.length - 1) {
    const a = blocks[i] as Block;
    const b = blocks[i + 1] as Block;
    if (a.y > b.y + 1e-9) {
      const total = a.w + b.w;
      blocks[i] = { y: (a.y * a.w + b.y * b.w) / total, w: total, xs: [...a.xs, ...b.xs] };
      blocks.splice(i + 1, 1);
      i = Math.max(i - 1, 0);
    } else i += 1;
  }
  return blocks.map((b) => ({ x: mean(b.xs), y: b.y, w: b.w }));
};

const clip = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const fitResponse = (sent: readonly number[], printed: readonly number[]): { xs: number[]; ys: number[] } => {
  const blocks = pava(
    sent,
    printed.map((c) => clip(c, 0, 100)),
    sent.map(() => 1),
  );
  const inner = blocks.filter((b) => b.x > 0 && b.x < 100);
  const xs = [0, ...inner.map((b) => b.x), 100];
  const raw = [0, ...inner.map((b) => b.y), 100];
  let best = -Infinity;
  const ys = raw.map((v) => (best = Math.max(best, v)));
  return { xs, ys };
};

const fitLateral = (x: readonly number[], residual: readonly number[], wt: readonly number[]): number[] => {
  const rows = x.map((xi, i) => {
    const sw = Math.sqrt(wt[i] as number) + 1e-9;
    return vanderRow((xi - LATERAL_CENTRE_MM) / LATERAL_CENTRE_MM, LATERAL_DEGREE + 1).map((v) => v * sw);
  });
  const rhs = residual.map((r, i) => r * (Math.sqrt(wt[i] as number) + 1e-9));
  return leastSquares(rows, rhs);
};

/** The model, fitted to every point. Needs points across the page's width in mid tones, enough to fit D (at least 5). */
export const fitModel = (points: readonly Point[]): Model => {
  const s = points.map((p) => p.sent);
  const x = points.map((p) => p.xMm);
  const c = points.map((p) => p.printed);
  let model: Model = { responseSent: [], responsePrinted: [], lateral: [] };
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const d = iteration === 0 ? undefined : model.lateral;
    const response = fitResponse(s, d === undefined ? c : c.map((ci, i) => ci - lateralAt(d, x[i] as number) * weight(ci)));
    const predicted = s.map((si) => interp(si, response.xs, response.ys));
    const wt = predicted.map(weight);
    const used = wt.map((v) => v > 0.2);
    const pick = <T>(a: readonly T[]): T[] => a.filter((_, i) => used[i]);
    const lateral = fitLateral(
      pick(x),
      pick(c.map((ci, i) => (ci - (predicted[i] as number)) / Math.max(wt[i] as number, 1e-6))),
      pick(wt),
    );
    model = { responseSent: response.xs, responsePrinted: response.ys, lateral };
  }
  return model;
};

/** What the model says a patch prints at. */
export const predict = (model: Model, sent: number, xMm: number): number => {
  const p = interp(sent, model.responseSent, model.responsePrinted);
  return p + lateralAt(model.lateral, xMm) * weight(p);
};
