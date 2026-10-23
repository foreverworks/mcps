import type { GreyPage } from "../pwg.js";
import { roundHalfEven } from "./numeric.js";

/**
 * The calibration sheet: a page of grey patches at known tones and places,
 * printed with no correction so what comes out is the printer's own
 * response, then scanned and measured (measure.ts). Pure.
 *
 * Layout on A4, in mm from the top-left paper corner:
 * - four corner marks (6 mm black squares) and one orientation mark (4 mm,
 *   beside the top-left one), for finding the page in a scan placed by hand,
 *   either way up;
 * - a grid of 9 mm patches, 11 mm apart, from 7 mm to 203 mm across (the
 *   printer's floor is 5 mm), so the left-right profile is sampled to the edges;
 * - its first and last rows solid black and its second and second-last rows
 *   bare paper: the two ends every patch in their column is measured between;
 * - between them, tones from 2% to 98% in steps of 2, each about seven times,
 *   shuffled so a tone's position says nothing about its value. Patches touch
 *   only white gaps: grey next to solid black prints darker for its first
 *   millimetres, so no tone patch neighbours a black one.
 */

export type PatchKind = "tone" | "black" | "paper";

export type Patch = {
  readonly kind: PatchKind;
  /** Coverage sent, % (0 paper .. 100 black). */
  readonly sent: number;
  /** Top-left corner and size, mm. */
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** Grid column and row, for the per-column ends. */
  readonly column: number;
  readonly row: number;
};

export type Mark = { readonly x: number; readonly y: number; readonly size: number };

export type SheetLayout = {
  readonly version: 1;
  readonly sheet: string;
  readonly pageMm: readonly [number, number];
  /** Corner marks' centres: top-left, top-right, bottom-left, bottom-right. */
  readonly corners: readonly Mark[];
  readonly orientation: Mark;
  readonly patches: readonly Patch[];
};

const PAGE: readonly [number, number] = [210, 297];
const PATCH = 9;
const PITCH = 11;
const LEFT = 7;
const TOP = 22;
const COLUMNS = 18;
const ROWS = 23;
const CORNER = 6;

/** A small deterministic generator, seeded from the sheet's name, so a sheet can be laid out again from its name alone. */
const generator = (name: string) => {
  let seed = 2166136261;
  for (const c of name) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
};

export const sheetLayout = (sheet: string): SheetLayout => {
  const tones = Array.from({ length: 49 }, (_, i) => 2 + 2 * i);
  const gridRows = ROWS - 4;
  const slots = gridRows * COLUMNS;
  const values = Array.from({ length: slots }, (_, i) => tones[i % tones.length] as number);
  const next = generator(sheet);
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [values[i], values[j]] = [values[j] as number, values[i] as number];
  }
  const patches: Patch[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const at = { x: LEFT + column * PITCH, y: TOP + row * PITCH, size: PATCH, column, row };
      if (row === 0 || row === ROWS - 1) patches.push({ kind: "black", sent: 100, ...at });
      else if (row === 1 || row === ROWS - 2) patches.push({ kind: "paper", sent: 0, ...at });
      else patches.push({ kind: "tone", sent: values[(row - 2) * COLUMNS + column] as number, ...at });
    }
  }
  const [w, h] = PAGE;
  return {
    version: 1,
    sheet,
    pageMm: PAGE,
    corners: [
      { x: 12, y: 12, size: CORNER },
      { x: w - 12, y: 12, size: CORNER },
      { x: 12, y: h - 12, size: CORNER },
      { x: w - 12, y: h - 12, size: CORNER },
    ],
    orientation: { x: 24, y: 12, size: 4 },
    patches,
  };
};

/** The grey level a coverage is sent as: 255 paper, 0 black. */
export const levelOf = (sent: number): number => roundHalfEven(255 * (1 - sent / 100));

/** The sheet as a raster at `dpi`, `size` pixels (the printer's sheet). */
export const renderSheet = (layout: SheetLayout, size: { readonly width: number; readonly height: number }, dpi: number): GreyPage => {
  const pixels = new Uint8Array(size.width * size.height).fill(255);
  const px = (mm: number): number => Math.round((mm * dpi) / 25.4);
  const fill = (x: number, y: number, w: number, h: number, level: number): void => {
    const x0 = Math.max(0, px(x));
    const x1 = Math.min(size.width, px(x + w));
    for (let row = Math.max(0, px(y)); row < Math.min(size.height, px(y + h)); row += 1) pixels.fill(level, row * size.width + x0, row * size.width + x1);
  };
  for (const p of layout.patches) if (p.kind !== "paper") fill(p.x, p.y, p.size, p.size, levelOf(p.sent));
  for (const m of [...layout.corners, layout.orientation]) fill(m.x - m.size / 2, m.y - m.size / 2, m.size, m.size, 0);
  return { ...size, pixels };
};
