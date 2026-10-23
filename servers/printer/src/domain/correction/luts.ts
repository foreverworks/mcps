import { lateralAt, type Model, weight } from "./model.js";
import { cumulativeMax, interp, linspace, roundHalfEven } from "./numeric.js";

/**
 * The correction applied to a page at print time: for each vertical band of
 * the page, a table from the grey a document asks for to the grey to send, so
 * that what comes out of the printer is what was asked for.
 *
 * For a requested coverage t at x the model is solved for the printed tone c
 * the response must deliver (c + D(x) w(c) = t), and R^-1(c) is sent. A
 * coverage under `whiteBelowPercent` stays paper white: the printer cannot
 * print it faithfully, and a speck of toner is worse than none.
 *
 * Grey levels are 8-bit sGray: 255 paper, 0 black; coverage % = (255 - v) / 255 * 100.
 */
export type Luts = {
  /** Band boundaries in pixels: band i covers columns edges[i] up to (not including) edges[i + 1]. */
  readonly edges: readonly number[];
  /** One 256-entry table per band. */
  readonly tables: readonly Uint8Array[];
};

export type LutOptions = {
  readonly widthPx: number;
  readonly dpi: number;
  /** Band width; 2 mm made visible steps on paper, 0.5 mm does not. */
  readonly bandMm?: number;
  readonly whiteBelowPercent?: number;
};

export const DEFAULT_BAND_MM = 0.5;
export const DEFAULT_WHITE_BELOW_PERCENT = 3;

/** R's knots with every flat stretch dropped, so it can be inverted: printed must rise by more than 0.05 points to count. */
const invertible = (model: Model): { sent: number[]; printed: number[] } => {
  const sent = [model.responseSent[0] as number];
  const printed = [model.responsePrinted[0] as number];
  for (let i = 1; i < model.responseSent.length; i += 1) {
    const y = model.responsePrinted[i] as number;
    if (y > (printed[printed.length - 1] as number) + 0.05) {
      sent.push(model.responseSent[i] as number);
      printed.push(y);
    }
  }
  return { sent, printed };
};

export const bandEdges = (widthPx: number, dpi: number, bandMm: number): number[] => {
  const mmPerPx = 25.4 / dpi;
  const bands = Math.ceil((widthPx * mmPerPx) / bandMm);
  return [...Array.from({ length: bands }, (_, i) => roundHalfEven((i * bandMm) / mmPerPx)), widthPx];
};

export const buildLuts = (model: Model, options: LutOptions): Luts => {
  const bandMm = options.bandMm ?? DEFAULT_BAND_MM;
  const whiteBelow = options.whiteBelowPercent ?? DEFAULT_WHITE_BELOW_PERCENT;
  const inverse = invertible(model);
  const mmPerPx = 25.4 / options.dpi;
  const edges = bandEdges(options.widthPx, options.dpi, bandMm);
  const grid = linspace(0, 100, 2001);
  const gridWeight = grid.map(weight);
  const tables = edges.slice(0, -1).map((left, i) => {
    const xMm = ((left + (edges[i + 1] as number)) / 2) * mmPerPx;
    const d = lateralAt(model.lateral, xMm);
    // monotone in c while |d| < 20; the running maximum keeps it invertible beyond
    const target = cumulativeMax(grid.map((c, k) => c + d * (gridWeight[k] as number)));
    const table = new Uint8Array(256);
    for (let v = 0; v < 256; v += 1) {
      const t = ((255 - v) / 255) * 100;
      if (t < whiteBelow) {
        table[v] = 255;
        continue;
      }
      const c = interp(t, target, grid);
      const sent = interp(c, inverse.printed, inverse.sent);
      table[v] = roundHalfEven(255 * (1 - sent / 100));
    }
    return table;
  });
  return { edges, tables };
};

/** The page with each band mapped through its table, in place: `pixels` is row-major, `width` columns. */
export const applyLuts = (pixels: Uint8Array, width: number, luts: Luts): void => {
  const height = pixels.length / width;
  const { edges, tables } = luts;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let b = 0; b < tables.length; b += 1) {
      const table = tables[b] as Uint8Array;
      const end = Math.min(edges[b + 1] as number, width);
      for (let x = edges[b] as number; x < end; x += 1) pixels[row + x] = table[pixels[row + x] as number] as number;
    }
  }
};
