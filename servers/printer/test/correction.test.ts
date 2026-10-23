/**
 * The correction against the reference it was validated with on paper: for
 * one calibration file, the per-band tables must be the reference's, entry for
 * entry. The fixture is invented points (test/fixtures/calibration.json, a
 * printer with the measured one's character: light greys dropping out, a step
 * near 25%, a left-right profile, noise) and the tables the reference
 * implementation (numpy) computed from them.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseCalibration } from "../src/domain/correction/calibration.js";
import { applyLuts, bandEdges, buildLuts } from "../src/domain/correction/luts.js";
import { fitModel, pava, predict, weight } from "../src/domain/correction/model.js";
import { interp, leastSquares, linspace, mean, roundHalfEven } from "../src/domain/correction/numeric.js";

const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const calibration = (() => {
  const parsed = parseCalibration(fixture("calibration.json").toString("utf8"));
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return parsed.calibration;
})();

describe("the numerics, as numpy computes them", () => {
  it("rounds a half to the even integer, as Python's round does", () => {
    expect([0.5, 1.5, 2.5, 127.5, 128.5, 2.4999999999999996, 3.5000000000000004].map(roundHalfEven)).toEqual([0, 2, 2, 128, 128, 2, 4]);
  });

  it("interpolates like numpy.interp: clamped at the ends, exact at a knot", () => {
    const xp = [0, 10, 20, 40];
    const fp = [0, 5, 5, 25];
    expect([-1, 0, 5, 10, 15, 30, 40, 41].map((x) => interp(x, xp, fp))).toEqual([0, 0, 2.5, 5, 5, 15, 25, 25]);
  });

  it("averages with numpy's pairwise summation, which a running sum does not match", () => {
    // numpy 2.2: np.mean of these 33 values is 10964.5610279316; a running sum gives 10964.561027931602
    const a = [
      75.79544029403024, 40.48437818077755, 48592.76965628126, 82.98529036589915, 0.3580493746949883, 5.046868558173903, 0.013974578496667889, 6.183689966753317,
      987.2592010330129, 98278.5476037653, 0.6019020743829455, 3101.475693193326, 7374.243362872512, 68.39839319154413, 5.598136790149003, 434.17183545378373,
      0.6404234015420902, 96.66063677707588, 442.6933591463411, 26049.23103919594, 0.0918464895700658, 9327.186435241008, 39882.354222426875, 7850.477596234768,
      0.11428193144282783, 8.280632784038989, 2.43910876887132, 0.07036425461655202, 191.06709150239055, 22170.38962141865, 96754.02502901433,
      0.054298995769001226, 0.8044581855253541,
    ];
    expect(mean(a)).toBe(10964.5610279316);
    expect(a.reduce((s, v) => s + v, 0) / a.length).toBe(10964.561027931602);
  });

  it("spaces a grid as numpy.linspace does, ending exactly at the stop", () => {
    const g = linspace(0, 100, 2001);
    expect([g[0], g[1], g[3], g[2000]]).toEqual([0, 0.05, 3 * 0.05, 100]);
  });

  it("solves least squares exactly for a consistent system", () => {
    const rows = [1, 2, 3, 4, 5].map((x) => [x * x, x, 1]);
    const c = leastSquares(rows, [1, 2, 3, 4, 5].map((x) => 2 * x * x - 3 * x + 7));
    c.forEach((v, i) => expect(v).toBeCloseTo([2, -3, 7][i] as number, 10));
  });

  it("pools adjacent violators into non-decreasing blocks", () => {
    expect(pava([3, 1, 2, 4], [1, 2, 3, 5], [1, 1, 1, 1])).toEqual([
      { x: 1, y: 2, w: 1 },
      { x: 2.5, y: 2, w: 2 },
      { x: 4, y: 5, w: 1 },
    ]);
  });
});

describe("the per-band tables", () => {
  const luts = buildLuts(fitModel(calibration.points), { widthPx: 4960, dpi: 600 });

  it("are the reference implementation's, entry for entry, in all 420 bands of 0.5 mm", () => {
    const want = fixture("calibration.luts.bin");
    const edges = JSON.parse(fixture("calibration.luts.edges.json").toString("utf8")) as number[];
    expect(luts.edges).toEqual(edges);
    expect(luts.tables).toHaveLength(420);
    let worst = 0;
    let differing = 0;
    luts.tables.forEach((table, band) =>
      table.forEach((v, i) => {
        const d = Math.abs(v - (want[band * 256 + i] as number));
        worst = Math.max(worst, d);
        if (d > 0) differing += 1;
      }),
    );
    // the requirement is within one grey level; the port matches exactly, which a byte-identical raster needs
    expect(worst).toBeLessThanOrEqual(1);
    expect(differing).toBe(0);
  });

  it("keep paper white and solid black, and drop what the printer cannot print faithfully", () => {
    for (const table of luts.tables) {
      expect(table[255]).toBe(255);
      expect(table[0]).toBe(0);
      expect(table[250]).toBe(255); // 2% coverage stays white
    }
  });

  it("are monotone: a darker grey asked for is never sent lighter", () => {
    for (const table of luts.tables) for (let v = 1; v < 256; v += 1) expect(table[v] as number).toBeGreaterThanOrEqual(table[v - 1] as number);
  });

  it("map each band of a page through its own table", () => {
    const width = 30;
    const pixels = new Uint8Array(width * 2).fill(128);
    applyLuts(pixels, width, { edges: [0, 10, 30], tables: [new Uint8Array(256).fill(1), new Uint8Array(256).fill(2)] });
    expect([...pixels.subarray(0, width)]).toEqual([...Array(10).fill(1), ...Array(20).fill(2)]);
  });

  it("cut the width into bands of whole pixels, the last ending at the page's edge", () => {
    const edges = bandEdges(4960, 600, 0.5);
    expect(edges.slice(0, 4)).toEqual([0, 12, 24, 35]);
    expect(edges.at(-1)).toBe(4960);
  });
});

describe("the model", () => {
  const model = fitModel(calibration.points);

  it("is pinned to paper and black, and its response never falls", () => {
    expect(model.responseSent[0]).toBe(0);
    expect(model.responsePrinted[0]).toBe(0);
    expect(model.responseSent.at(-1)).toBe(100);
    expect(model.responsePrinted.at(-1)).toBe(100);
    for (let i = 1; i < model.responsePrinted.length; i += 1) expect(model.responsePrinted[i] as number).toBeGreaterThanOrEqual(model.responsePrinted[i - 1] as number);
  });

  it("predicts the points it was fitted to within the noise they were made with", () => {
    const error = calibration.points.reduce((s, p) => s + Math.abs(predict(model, p.sent, p.xMm) - p.printed), 0) / calibration.points.length;
    expect(error).toBeLessThan(1.5);
  });

  it("lets the profile act fully on mid tones and not at all on paper or black", () => {
    expect([0, 10, 20, 50, 80, 90, 100].map(weight)).toEqual([0, 0.5, 1, 1, 1, 0.5, 0]);
  });
});

describe("a calibration file", () => {
  it("is refused with every problem named, and with too few mid tones to fit the profile", () => {
    const bad = parseCalibration(JSON.stringify({ points: [["A", 120, 10, 5], ["A", 50, 300, 50], ["", 1, 1, 1], [1, 2]] }));
    expect(bad).toEqual({ ok: false, problems: ["point 0: sent must be 0..100", "point 1: x must be 0..220 mm", "point 2: sheet must be a name", "point 3: not [sheet, sent %, x mm, printed %]"] });
    expect(parseCalibration(JSON.stringify({ points: [["A", 50, 10, 52]] }))).toMatchObject({ ok: false, problems: [expect.stringContaining("left-right profile")] });
    expect(parseCalibration("{")).toMatchObject({ ok: false });
  });
});
