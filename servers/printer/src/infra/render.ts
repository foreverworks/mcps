import { spawn } from "node:child_process";

import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import type { Render } from "../app/ports.js";
import { fail } from "../domain/errors.js";
import { pageCountOf, pdfPagesOf } from "../domain/pages.js";
import type { GreyPage } from "../domain/pwg.js";
import { greyFromRgba, parsePgm } from "../domain/raster.js";

/**
 * PDFs through poppler (pdfinfo, pdftoppm), images through pure-JavaScript
 * decoders. pdftoppm draws with antialiasing off, so text and vector edges
 * stay solid black on white: a grey fringe would be one more tone for the
 * printer to dither, and the correction would then darken or drop it.
 */

/** About 35 MB for an A4 page at 600 dpi, grey; a larger raster is refused. */
const MAX_RASTER_BYTES = 64 * 1024 * 1024;
const PDFINFO_MS = 30_000;
const PAGE_MS = 120_000;

type Ran = { readonly code: number; readonly stdout: Buffer; readonly stderr: string };

const run = (cmd: string, args: readonly string[], timeoutMs: number, maxBytes: number): Promise<Ran> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let over = false;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        child.kill("SIGKILL");
      } else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (err.length < 64) err.push(chunk);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout: Buffer.alloc(0), stderr: e.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(err).toString("utf8").trim();
      resolve({
        code: over ? 125 : (code ?? 124),
        stdout: Buffer.concat(out),
        stderr: over ? `output over ${maxBytes} bytes` : signal === null ? stderr : `${stderr} killed by ${signal} after ${timeoutMs} ms`.trim(),
      });
    });
  });

const toolProblem = (tool: string, ran: Ran): string =>
  ran.code === 127 ? `${tool} could not be run (${ran.stderr}); it comes with poppler (poppler-utils)` : `${tool} failed (exit ${ran.code}): ${ran.stderr.slice(0, 300)}`;

export type RenderOptions = {
  /** The poppler programs, by name on PATH unless given. */
  readonly pdfinfo?: string;
  readonly pdftoppm?: string;
};

export const makeRender = (options: RenderOptions = {}): Render => {
  const pdfinfo = options.pdfinfo ?? "pdfinfo";
  const pdftoppm = options.pdftoppm ?? "pdftoppm";
  return {
    pdfPages: async (path) => {
      const first = await run(pdfinfo, [path], PDFINFO_MS, 1 << 20);
      if (first.code !== 0) return fail({ kind: "render", message: toolProblem("pdfinfo", first) });
      const count = pageCountOf(first.stdout.toString("utf8"));
      if (count === undefined || count < 1) return fail({ kind: "render", message: "pdfinfo found no pages in the PDF" });
      const each = await run(pdfinfo, ["-f", "1", "-l", String(count), path], PDFINFO_MS, 4 << 20);
      if (each.code !== 0) return fail({ kind: "render", message: toolProblem("pdfinfo", each) });
      const pages = pdfPagesOf(each.stdout.toString("utf8"));
      return pages.length === count ? pages : fail({ kind: "render", message: `pdfinfo listed ${pages.length} page sizes for ${count} pages` });
    },
    pdfPage: async (path, page, dpi) => {
      const ran = await run(
        pdftoppm,
        ["-f", String(page), "-l", String(page), "-r", String(dpi), "-gray", "-aa", "no", "-aaVector", "no", "-singlefile", path],
        PAGE_MS,
        MAX_RASTER_BYTES,
      );
      if (ran.code !== 0) return fail({ kind: "render", message: toolProblem("pdftoppm", ran) });
      try {
        return parsePgm(ran.stdout);
      } catch (cause) {
        return fail({ kind: "render", message: `pdftoppm's page ${page} is not a grey image: ${(cause as Error).message}` });
      }
    },
    image: (bytes) => {
      try {
        if (bytes[0] === 0x89) {
          const png = PNG.sync.read(Buffer.from(bytes));
          return greyFromRgba(png.data, png);
        }
        const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
        return greyFromRgba(decoded.data, decoded);
      } catch (cause) {
        return fail({ kind: "render", message: `the image does not decode: ${(cause as Error).message}` });
      }
    },
    png: (page: GreyPage) => {
      const png = new PNG({ width: page.width, height: page.height, colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
      png.data = Buffer.from(page.pixels);
      return PNG.sync.write(png, { colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
    },
  };
};
