/**
 * The calibration sheet and its measurement, against scans made here: the
 * sheet as a printer with a known response would print it, placed askew and
 * off the corner (and once upside down), at the scanner's own levels for
 * paper and black, with the light falling off down the glass and specks of
 * noise. The measurement must give back the response.
 */
import { describe, expect, it } from "vitest";

import { measureSheet } from "../src/domain/correction/measure.js";
import { sheetLayout } from "../src/domain/correction/sheet.js";
import type { GreyPage } from "../src/domain/pwg.js";
import { printedOf, scanned } from "./scans.js";

describe("the calibration sheet", () => {
  const layout = sheetLayout("cal-test");

  it("lays out 342 tone patches from 2% to 98%, each tone six or seven times, and the ends of every column", () => {
    const tones = layout.patches.filter((p) => p.kind === "tone");
    expect(tones).toHaveLength(342);
    const counts = new Map<number, number>();
    for (const t of tones) counts.set(t.sent, (counts.get(t.sent) ?? 0) + 1);
    expect([...counts.keys()].toSorted((a, b) => a - b)).toEqual(Array.from({ length: 49 }, (_, i) => 2 + 2 * i));
    expect(Math.min(...counts.values())).toBeGreaterThanOrEqual(6);
    expect(layout.patches.filter((p) => p.kind === "black")).toHaveLength(36);
    expect(Math.min(...layout.patches.map((p) => p.x))).toBe(7);
    expect(Math.max(...layout.patches.map((p) => p.x + p.size))).toBe(203);
    expect(sheetLayout("cal-test")).toEqual(layout);
    expect(sheetLayout("cal-other").patches.map((p) => p.sent)).not.toEqual(layout.patches.map((p) => p.sent));
  });

  for (const way of [
    { dpi: 300, angle: 0.8, shift: [2.5, 1.5] as [number, number], turned: false },
    { dpi: 150, angle: -0.6, shift: [1, 3] as [number, number], turned: true },
  ]) {
    it(`is measured back to the printer's response from a scan at ${way.dpi} dpi, ${way.angle} degrees askew${way.turned ? ", upside down" : ""}`, () => {
      const measured = measureSheet(layout, scanned(layout, way));
      if (!measured.ok) throw new Error(measured.problem);
      expect(measured.located.turned).toBe(way.turned);
      expect(measured.located.residualMm).toBeLessThan(0.5);
      expect(measured.points).toHaveLength(342);
      const errors = measured.points.map((p) => Math.abs(p.printed - printedOf(p.sent, p.xMm)));
      expect(Math.max(...errors)).toBeLessThan(1.5);
      expect(errors.reduce((s, e) => s + e, 0) / errors.length).toBeLessThan(0.6);
    }, 60_000);
  }

  it("says what is wrong with a scan that is not the sheet", () => {
    const blank: GreyPage = { width: 1240, height: 1754, pixels: new Uint8Array(1240 * 1754).fill(240) };
    expect(measureSheet(layout, blank)).toMatchObject({ ok: false, problem: expect.stringContaining("marks were not all found") });
  });
});
