/**
 * How pages are laid on the sheet, how a document's pages are planned, and
 * where the device is: the pure parts between the file and the raster.
 */
import { describe, expect, it } from "vitest";

import { endpointsFrom } from "../src/domain/config.js";
import { A4_PT, documentKind, pageRange, pdfPagesOf, renderPlan } from "../src/domain/pages.js";
import type { GreyPage } from "../src/domain/pwg.js";
import { a4At, centre, greyFromRgba, parsePgm, placeImage, placeRendered, preview, resize, rotateLeft } from "../src/domain/raster.js";

const page = (width: number, height: number, fill: (x: number, y: number) => number): GreyPage => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height }, (_, i) => fill(i % width, Math.floor(i / width))),
});

describe("the sheet", () => {
  it("is A4 in whole dots: 4960 x 7015 at 600 dpi", () => {
    expect(a4At(600)).toEqual({ width: 4960, height: 7015 });
    expect(a4At(300)).toEqual({ width: 2480, height: 3507 });
  });

  it("takes a rendered A4 page a pixel larger by cropping it, never resampling", () => {
    const rendered = page(12, 9, (x, y) => (x + y) % 256);
    const placed = placeRendered(rendered, { width: 11, height: 8 });
    expect(placed.placement).toBe("cropped");
    expect([...placed.page.pixels.subarray(0, 11)]).toEqual([...rendered.pixels.subarray(0, 11)]);
    expect(placed.page.pixels[8 * 11 - 1]).toBe(rendered.pixels[7 * 12 + 10]);
  });

  it("centres a smaller page on white", () => {
    const placed = centre(page(2, 2, () => 0), { width: 4, height: 4 });
    expect([...placed.pixels]).toEqual([255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("turns a landscape page a quarter counter-clockwise", () => {
    // 3 wide, 2 tall: rows [1 2 3] [4 5 6] -> 2 wide, 3 tall: [3 6] [2 5] [1 4]
    const turned = rotateLeft({ width: 3, height: 2, pixels: Uint8Array.from([1, 2, 3, 4, 5, 6]) });
    expect(turned).toEqual({ width: 2, height: 3, pixels: Uint8Array.from([3, 6, 2, 5, 1, 4]) });
  });

  it("shrinks by averaging areas and grows by repeating pixels", () => {
    const checker = page(4, 4, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));
    expect([...resize(checker, { width: 2, height: 2 }).pixels]).toEqual([128, 128, 128, 128]);
    expect([...resize(page(2, 1, (x) => x * 200), { width: 4, height: 2 }).pixels]).toEqual([0, 0, 200, 200, 0, 0, 200, 200]);
    expect([...preview(page(10, 5, () => 100), 5).pixels]).toEqual([100, 100]);
  });

  it("fits an image to the sheet, turning a landscape one", () => {
    const placed = placeImage(page(40, 20, () => 0), { width: 10, height: 20 });
    expect(placed).toMatchObject({ placement: "fitted", rotated: true });
    expect(placed.page.pixels.every((v) => v === 0)).toBe(true);
  });

  it("reads pdftoppm's grey PGM, and lays colour over white paper as luma", () => {
    const pgm = Buffer.concat([Buffer.from("P5\n# a comment\n3 2\n255\n"), Buffer.from([0, 128, 255, 1, 2, 3])]);
    expect(parsePgm(pgm)).toEqual({ width: 3, height: 2, pixels: Uint8Array.from([0, 128, 255, 1, 2, 3]) });
    expect(() => parsePgm(Buffer.from("P6\n1 1\n255\nabc"))).toThrow(/binary PGM/);
    // red, green, blue, and black at zero opacity (paper)
    const grey = greyFromRgba(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]), { width: 4, height: 1 });
    expect([...grey.pixels]).toEqual([76, 150, 29, 255]);
  });
});

describe("a document's pages", () => {
  it("are read from pdfinfo, a quarter-turned page with its sides swapped", () => {
    const info = ["Pages:           2", "Page    1 size:  595.276 x 841.89 pts (A4)", "Page    1 rot:   0", "Page    2 size:  612 x 792 pts (letter)", "Page    2 rot:   90"].join("\n");
    expect(pdfPagesOf(info)).toEqual([
      { page: 1, widthPt: 595.276, heightPt: 841.89 },
      { page: 2, widthPt: 792, heightPt: 612 },
    ]);
  });

  it("are chosen by a range, in the order given", () => {
    expect(pageRange("2-3, 1", 3)).toEqual({ ok: true, pages: [2, 3, 1] });
    expect(pageRange(undefined, 2)).toEqual({ ok: true, pages: [1, 2] });
    expect(pageRange("4", 3)).toEqual({ ok: false, problem: 'the document has 3 pages; "4" goes past it' });
    expect(pageRange("a", 3)).toMatchObject({ ok: false });
  });

  it("are rendered at the sheet's resolution when they are the sheet's size or smaller, lower when larger, turned when landscape", () => {
    expect(renderPlan({ page: 1, widthPt: 595.276, heightPt: 841.89 }, A4_PT, 600)).toEqual({ dpi: 600, rotate: false });
    expect(renderPlan({ page: 1, widthPt: 420, heightPt: 595 }, A4_PT, 600)).toEqual({ dpi: 600, rotate: false });
    expect(renderPlan({ page: 1, widthPt: 612, heightPt: 792 }, A4_PT, 600)).toEqual({ dpi: 583.603, rotate: false });
    expect(renderPlan({ page: 1, widthPt: 841.89, heightPt: 595.276 }, A4_PT, 600)).toEqual({ dpi: 600, rotate: true });
  });

  it("are recognised by their signature, not their name", () => {
    expect(documentKind(Buffer.from("%PDF-1.7"))).toBe("pdf");
    expect(documentKind(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe("png");
    expect(documentKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(documentKind(Buffer.from("GIF89a"))).toBeUndefined();
  });
});

describe("the device's address", () => {
  it("comes from an IPP URI, with eSCL on the same host's web server", () => {
    const e = endpointsFrom({ PRINTER_URI: "ipps://192.0.2.10:443/ipp/print", PRINTER_TLS_SHA256: "AB:".repeat(31) + "AB" });
    expect(e.printer).toEqual({ printerUri: "ipps://192.0.2.10:443/ipp/print", url: new URL("https://192.0.2.10:443/ipp/print") });
    expect(e.scanner).toEqual(new URL("https://192.0.2.10/eSCL"));
    expect(e.pin).toBe("ab".repeat(32));
  });

  it("defaults IPP to port 631 and its usual path, and takes http(s) URLs as well", () => {
    expect(endpointsFrom({ PRINTER_URI: "ipp://printer.example" }).printer).toEqual({ printerUri: "ipp://printer.example:631/ipp/print", url: new URL("http://printer.example:631/ipp/print") });
    expect(endpointsFrom({ PRINTER_URI: "https://printer.example/ipp/print", PRINTER_ESCL_URL: "https://scanner.example/eSCL" }).scanner).toEqual(new URL("https://scanner.example/eSCL"));
  });

  it("names the variable that is missing or wrong", () => {
    expect(endpointsFrom({}).printer).toMatchObject({ kind: "config", variable: "PRINTER_URI" });
    expect(endpointsFrom({}).scanner).toMatchObject({ kind: "config", variable: "PRINTER_URI" });
    expect(endpointsFrom({ PRINTER_URI: "lpd://x/q" }).printer).toMatchObject({ kind: "config", variable: "PRINTER_URI" });
    expect(endpointsFrom({ PRINTER_URI: "ipp://x", PRINTER_TLS_SHA256: "abc" }).pin).toMatchObject({ kind: "config", variable: "PRINTER_TLS_SHA256" });
  });
});
