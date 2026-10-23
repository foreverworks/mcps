/**
 * The PWG raster encoder, held to the reference encoder's bytes (a page it
 * wrote, test/fixtures/small.pwg, from small.png) and to its own decoder on
 * pages built to hit every case: runs over 128, literals over 128, single
 * bytes between runs, more than 256 identical lines, widths that are no
 * multiple of anything.
 */
import { readFileSync } from "node:fs";

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { A4, decodeDocument, encodeDocument, encodeLine, type GreyPage } from "../src/domain/pwg.js";

const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const pageFromPng = (bytes: Buffer): GreyPage => {
  const png = PNG.sync.read(bytes);
  const pixels = new Uint8Array(png.width * png.height);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = png.data[i * 4] as number;
  return { width: png.width, height: png.height, pixels };
};

/** A deterministic generator, so a failure can be reproduced. */
const lcg = (seed: number) => () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;

describe("PWG raster", () => {
  it("writes the reference encoder's bytes for the same page, and reads them back to its pixels", () => {
    const reference = fixture("small.pwg");
    const page = pageFromPng(fixture("small.png"));
    expect(encodeDocument([page], A4).equals(reference)).toBe(true);
    const [decoded] = decodeDocument(reference);
    expect(decoded?.width).toBe(333);
    expect(Buffer.from(decoded?.pixels ?? []).equals(Buffer.from(page.pixels))).toBe(true);
  });

  it("round-trips noise, runs and repeated lines exactly", () => {
    const next = lcg(42);
    const pages: GreyPage[] = [
      { width: 1, height: 1, pixels: new Uint8Array([7]) },
      { width: 257, height: 600, pixels: new Uint8Array(257 * 600).fill(255) },
      { width: 391, height: 300, pixels: Uint8Array.from({ length: 391 * 300 }, () => Math.floor(next() * 256)) },
      { width: 500, height: 40, pixels: Uint8Array.from({ length: 500 * 40 }, (_, i) => (Math.floor((i % 500) / (1 + Math.floor(next() * 3))) % 3) * 100) },
    ];
    const decoded = decodeDocument(encodeDocument(pages, A4));
    expect(decoded).toHaveLength(pages.length);
    decoded.forEach((page, i) => {
      expect([page.width, page.height]).toEqual([pages[i]?.width, pages[i]?.height]);
      expect(Buffer.from(page.pixels).equals(Buffer.from(pages[i]?.pixels ?? []))).toBe(true);
      expect(page).toMatchObject({ dpi: 600, totalPages: 4, pageSizeName: "iso_a4_210x297mm" });
    });
  });

  it("codes a line as runs and literals, a lone byte as a run of one", () => {
    expect([...encodeLine(new Uint8Array([5]))]).toEqual([0, 5]);
    expect([...encodeLine(new Uint8Array([1, 2, 3]))]).toEqual([254, 1, 2, 3]);
    expect([...encodeLine(new Uint8Array([9, 9, 9, 4, 6, 6]))]).toEqual([2, 9, 0, 4, 1, 6]);
    expect([...encodeLine(new Uint8Array(300).fill(0))]).toEqual([127, 0, 127, 0, 43, 0]);
    const literals = encodeLine(Uint8Array.from({ length: 130 }, (_, i) => i));
    expect([literals[0], literals[128], literals[129], literals[130]]).toEqual([129, 127, 255, 128]);
  });

  it("refuses a document that is not PWG or is cut short", () => {
    expect(() => decodeDocument(new Uint8Array([1, 2, 3, 4]))).toThrow(/sync word/);
    const whole = encodeDocument([{ width: 10, height: 10, pixels: new Uint8Array(100) }], A4);
    expect(() => decodeDocument(whole.subarray(0, whole.length - 1))).toThrow(/cut short/);
  });
});
