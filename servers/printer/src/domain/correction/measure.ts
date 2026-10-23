import type { GreyPage } from "../pwg.js";
import type { Point } from "./model.js";
import { leastSquares } from "./numeric.js";
import type { Mark, SheetLayout } from "./sheet.js";

/**
 * A scan of a calibration sheet, measured. Pure.
 *
 * 1. The page is found by its marks: each corner mark is looked for near
 *    where it would be with the page upright and with it turned half round
 *    (a sheet placed either way up), and the orientation mark decides which.
 * 2. An affine map from the layout (mm) to the scan (pixels) is fitted to
 *    the five marks, so a page placed a little askew or off the corner, and a
 *    scan at any resolution, measure the same.
 * 3. Each patch is sampled over its inner half, a trimmed mean so a speck of
 *    dust or toner does not count, and turned into coverage between the paper
 *    and the black of its own column (each end the line between its top and
 *    bottom samples), since a scanner's light is not even across the glass.
 */

export type Affine = readonly [number, number, number, number, number, number];

const apply = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

export const fitAffine = (from: readonly (readonly [number, number])[], to: readonly (readonly [number, number])[]): Affine => {
  const rows = from.map(([x, y]) => [x, y, 1]);
  const [a, b, c] = leastSquares(rows, to.map((p) => p[0])) as [number, number, number];
  const [d, e, f] = leastSquares(rows, to.map((p) => p[1])) as [number, number, number];
  return [a, b, c, d, e, f];
};

type Blob = { readonly x: number; readonly y: number; readonly area: number; readonly width: number; readonly height: number };

/** Dark connected regions (4-connected, darker than `threshold`) wholly inside a window of the scan. */
const blobsIn = (scan: GreyPage, x0: number, y0: number, x1: number, y1: number, threshold: number): readonly Blob[] => {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(scan.width, Math.ceil(x1));
  const bottom = Math.min(scan.height, Math.ceil(y1));
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return [];
  const seen = new Uint8Array(w * h);
  const found: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (seen[start] === 1) continue;
    seen[start] = 1;
    const sx = start % w;
    const sy = Math.floor(start / w);
    if ((scan.pixels[(top + sy) * scan.width + left + sx] as number) >= threshold) continue;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = sx;
    let maxX = sx;
    let minY = sy;
    let maxY = sy;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % w;
      const y = Math.floor(i / w);
      area += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] === 1) continue;
        seen[j] = 1;
        if ((scan.pixels[(top + ny) * scan.width + left + nx] as number) < threshold) stack.push(j);
      }
    }
    // a region cut by the window's edge is only partly seen: never a mark
    if (minX > 0 && minY > 0 && maxX < w - 1 && maxY < h - 1) found.push({ x: left + sumX / area, y: top + sumY / area, area, width: maxX - minX + 1, height: maxY - minY + 1 });
  }
  return found;
};

/** The square mark of `size` mm nearest where it is expected, or undefined: a dark region of about its area and shape. */
const markNear = (scan: GreyPage, mark: Mark, at: readonly [number, number], pxPerMm: number, threshold: number): readonly [number, number] | undefined => {
  const reach = 12 * pxPerMm;
  const side = mark.size * pxPerMm;
  const candidates = blobsIn(scan, at[0] - reach, at[1] - reach, at[0] + reach, at[1] + reach, threshold).filter(
    (b) => b.area > 0.5 * side * side && b.area < 1.6 * side * side && b.width < 1.5 * side && b.height < 1.5 * side && b.width > 0.6 * side && b.height > 0.6 * side,
  );
  const best = candidates.toSorted((a, b) => Math.hypot(a.x - at[0], a.y - at[1]) - Math.hypot(b.x - at[0], b.y - at[1]))[0];
  return best === undefined ? undefined : [best.x, best.y];
};

export type Located = { readonly affine: Affine; readonly turned: boolean; readonly residualMm: number };

export type Measured =
  | {
      readonly ok: true;
      readonly located: Located;
      readonly points: readonly Point[];
      /** Paper and black as scanned, the mean over the sheet, for the result. */
      readonly paper: number;
      readonly black: number;
    }
  | { readonly ok: false; readonly problem: string };

/** Where the page is in the scan, from its marks. */
export const locate = (layout: SheetLayout, scan: GreyPage): Located | { readonly problem: string } => {
  const pxPerMm = scan.width / layout.pageMm[0];
  const threshold = 110;
  const marks = [...layout.corners, layout.orientation];
  const tryWay = (turned: boolean) => {
    const expected = (m: Mark): [number, number] => {
      const x = turned ? layout.pageMm[0] - m.x : m.x;
      const y = turned ? layout.pageMm[1] - m.y : m.y;
      return [x * pxPerMm, y * pxPerMm];
    };
    const found = marks.map((m) => markNear(scan, m, expected(m), pxPerMm, threshold));
    return { turned, found };
  };
  const ways = [tryWay(false), tryWay(true)].filter((w) => w.found.every((f) => f !== undefined));
  const way = ways[0];
  if (way === undefined) return { problem: "the sheet's corner and orientation marks were not all found: scan the whole sheet, flat on the glass, at 150 or 300 dpi" };
  // from the page as laid out to where each mark was found: a turned page's map includes the half turn
  const affine = fitAffine(
    marks.map((m) => [m.x, m.y] as const),
    way.found as readonly (readonly [number, number])[],
  );
  const residualMm =
    Math.max(
      ...marks.map((m, i) => {
        const [u, v] = apply(affine, m.x, m.y);
        const [fu, fv] = way.found[i] as readonly [number, number];
        return Math.hypot(u - fu, v - fv);
      }),
    ) / pxPerMm;
  if (residualMm > 1.5) return { problem: `the marks do not sit where the sheet puts them (off by ${residualMm.toFixed(1)} mm): is this the sheet named in the call, scanned flat?` };
  return { affine, turned: way.turned, residualMm };
};

/** The mean of the middle 80% of values. */
const trimmedMean = (values: number[]): number => {
  values.sort((a, b) => a - b);
  const cut = Math.floor(values.length * 0.1);
  const kept = values.slice(cut, values.length - cut);
  return kept.reduce((s, v) => s + v, 0) / kept.length;
};

const sample = (scan: GreyPage, affine: Affine, x: number, y: number, size: number): number => {
  const inset = size / 4;
  const steps = 12;
  const values: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < steps; j += 1) {
      const [u, v] = apply(affine, x + inset + ((i + 0.5) * (size - 2 * inset)) / steps, y + inset + ((j + 0.5) * (size - 2 * inset)) / steps);
      const px = Math.min(scan.width - 1, Math.max(0, Math.round(u)));
      const py = Math.min(scan.height - 1, Math.max(0, Math.round(v)));
      values.push(scan.pixels[py * scan.width + px] as number);
    }
  }
  return trimmedMean(values);
};

export const measureSheet = (layout: SheetLayout, scan: GreyPage): Measured => {
  const located = locate(layout, scan);
  if ("problem" in located) return { ok: false, problem: located.problem };
  const read = layout.patches.map((p) => ({ ...p, value: sample(scan, located.affine, p.x, p.y, p.size) }));
  const columns = [...new Set(read.map((p) => p.column))];
  const ends = new Map(
    columns.map((c) => {
      const line = (kind: "black" | "paper") => {
        const mine = read.filter((p) => p.column === c && p.kind === kind).toSorted((a, b) => a.y - b.y);
        const first = mine[0];
        const last = mine.at(-1);
        if (first === undefined || last === undefined) return (_y: number) => Number.NaN;
        return (y: number) => (last.y === first.y ? first.value : first.value + ((last.value - first.value) * (y - first.y)) / (last.y - first.y));
      };
      return [c, { black: line("black"), paper: line("paper") }] as const;
    }),
  );
  const paper = read.filter((p) => p.kind === "paper").reduce((s, p, _i, a) => s + p.value / a.length, 0);
  const black = read.filter((p) => p.kind === "black").reduce((s, p, _i, a) => s + p.value / a.length, 0);
  if (!(paper - black > 60)) return { ok: false, problem: `paper (${paper.toFixed(0)}) and black (${black.toFixed(0)}) scan too close: is the sheet face down on the glass, the lid closed?` };
  const points: Point[] = read
    .filter((p) => p.kind === "tone")
    .map((p) => {
      const end = ends.get(p.column) as { black: (y: number) => number; paper: (y: number) => number };
      const top = end.paper(p.y);
      const bottom = end.black(p.y);
      const printed = ((top - p.value) / (top - bottom)) * 100;
      return { sheet: layout.sheet, sent: p.sent, xMm: p.x + p.size / 2, printed: Math.round(printed * 1000) / 1000 };
    });
  return { ok: true, located, points, paper, black };
};
