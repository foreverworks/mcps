/**
 * Scans of a calibration sheet made here, for the tests: the sheet as a
 * printer with a known response would print it, placed on the glass askew
 * and off the corner (or upside down), at a scanner's own levels for paper
 * and black, with the light falling off down the glass and specks of noise.
 */
import { renderSheet, type SheetLayout } from "../src/domain/correction/sheet.js";
import type { GreyPage } from "../src/domain/pwg.js";

/** A printer: light greys drop out, a step, a left-right profile. */
export const printedOf = (sent: number, xMm: number): number => {
  const base = sent < 10 ? 0 : sent < 25 ? (sent - 10) * 0.7 : 10.5 + (sent - 25) * 1.2;
  const z = (xMm - 105) / 105;
  const mid = Math.min(1, base / 20, (100 - base) / 20);
  return Math.min(100, Math.max(0, base + (8 * z * z - 4) * Math.max(0, mid)));
};

/** The sheet as printed by that printer, then scanned at `dpi`, `angle` degrees askew, `shift` mm off the corner, turned or not. */
export const scanned = (layout: SheetLayout, options: { dpi: number; angle: number; shift: [number, number]; turned: boolean }): GreyPage => {
  const printedLayout = { ...layout, patches: layout.patches.map((p) => (p.kind === "tone" ? { ...p, sent: printedOf(p.sent, p.x + p.size / 2) } : p)) };
  const pageDpi = 300;
  const page = renderSheet(printedLayout, { width: Math.round((210 / 25.4) * pageDpi), height: Math.round((297 / 25.4) * pageDpi) }, pageDpi);
  const width = Math.round((216 / 25.4) * options.dpi);
  const height = Math.round((297 / 25.4) * options.dpi);
  const pixels = new Uint8Array(width * height);
  const a = (options.angle * Math.PI) / 180;
  let noise = 7;
  for (let v = 0; v < height; v += 1) {
    for (let u = 0; u < width; u += 1) {
      // scan pixel -> glass mm -> page mm (undo the shift and the turn on the glass)
      const gx = (u / options.dpi) * 25.4 - options.shift[0];
      const gy = (v / options.dpi) * 25.4 - options.shift[1];
      let x = Math.cos(a) * gx + Math.sin(a) * gy;
      let y = -Math.sin(a) * gx + Math.cos(a) * gy;
      if (options.turned) [x, y] = [210 - x, 297 - y];
      const px = Math.floor((x / 25.4) * pageDpi);
      const py = Math.floor((y / 25.4) * pageDpi);
      const level = px >= 0 && py >= 0 && px < page.width && py < page.height ? (page.pixels[py * page.width + px] as number) : 255;
      const paper = 238 - (v / height) * 10;
      const black = 26;
      noise = (noise * 1103515245 + 12345) % 2147483648;
      const speck = noise % 997 === 0 ? -120 : ((noise >> 8) % 5) - 2;
      pixels[v * width + u] = Math.max(0, Math.min(255, Math.round(black + ((paper - black) * level) / 255 + speck)));
    }
  }
  return { width, height, pixels };
};

