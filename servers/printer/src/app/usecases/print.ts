import type { FileSource } from "@foreverworks/mcp-kit";

import { fitModel } from "../../domain/correction/model.js";
import { applyLuts, buildLuts, type Luts } from "../../domain/correction/luts.js";
import { fail, inputError } from "../../domain/errors.js";
import { A4_PT, documentKind, pageRange, renderPlan } from "../../domain/pages.js";
import { A4, encodePage, type GreyPage } from "../../domain/pwg.js";
import { a4At, placeImage, placeRendered, type Placement, preview, rotateLeft } from "../../domain/raster.js";
import type { Deps, SavedFile } from "../ports.js";
import { pwgDocument, ready, sendAndWait } from "./print/deliver.js";

/**
 * Print a document as the printer's own raster, corrected for the printer.
 *
 * The page is rendered at the printer's resolution in grey, laid on the
 * sheet without resampling when it is the sheet's size, corrected column by
 * column (domain/correction), and sent as lossless PWG raster, so what the
 * printer receives is exactly the pixels computed here: no driver, no JPEG,
 * no second scaling. Copies are the pages repeated in the stream (collated),
 * which every printer honours, unlike the `copies` attribute.
 */

export const MAX_SHEETS = 100;
export const MAX_COPIES = 20;
const PREVIEW_FACTOR = 5;

export type PrintArgs = {
  readonly file: FileSource;
  readonly copies: number;
  /** Unset: on when a calibration is loaded. */
  readonly correction?: boolean | undefined;
  readonly pages?: string | undefined;
  readonly dryRun: boolean;
  readonly jobName?: string | undefined;
};

export type PreparedPage = {
  readonly page: number;
  readonly placement: Placement;
  readonly rotated: boolean;
  /** The resolution it was rendered at, for a PDF page. */
  readonly renderedDpi?: number;
  readonly source: { readonly width: number; readonly height: number };
};

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

const stemOf = (name: string): string => (name.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document").slice(0, 80);

export const print = async (deps: Deps, args: PrintArgs) => {
  if (!Number.isInteger(args.copies) || args.copies < 1 || args.copies > MAX_COPIES) return fail(inputError(`copies must be 1 to ${MAX_COPIES}`));
  const file = await deps.inputFiles(args.file);
  const kind = documentKind(file.bytes) ?? fail(inputError(`${file.name || "the file"} is not a PDF, PNG or JPEG`));

  const calibration = await deps.calibration.load();
  if (args.correction === true && calibration === undefined) {
    return fail({ kind: "calibration", message: `correction was asked for and no calibration is loaded (${deps.calibration.path})` });
  }
  const correct = args.correction ?? calibration !== undefined;
  const sheet = a4At(A4.dpi);
  const luts: Luts | undefined = correct && calibration !== undefined ? buildLuts(fitModel(calibration.points), { widthPx: sheet.width, dpi: A4.dpi }) : undefined;

  if (!args.dryRun) await ready(deps);
  const scratch = await deps.scratch();
  try {
    const source = await scratch.write(`source.${kind}`, file.bytes);
    const pdfPages = kind === "pdf" ? await deps.render.pdfPages(source) : [];
    const range = kind === "pdf" ? pageRange(args.pages, pdfPages.length) : pageRange(args.pages, 1);
    const plan = range.ok ? range.pages : fail(inputError(kind === "pdf" ? range.problem : `an image has one page: ${range.problem}`));
    const sheets = plan.length * args.copies;
    if (sheets > MAX_SHEETS) return fail(inputError(`that is ${sheets} sheets; one call prints at most ${MAX_SHEETS}`));

    const stem = stemOf(file.name || `document.${kind}`);
    const outDir = `print/${stamp(deps.now())}-${stem}`;
    const prepared: PreparedPage[] = [];
    const previews: SavedFile[] = [];
    const encoded: string[] = [];
    for (const [i, number] of plan.entries()) {
      let page: GreyPage;
      let info: PreparedPage;
      if (kind === "pdf") {
        const pdfPage = pdfPages[number - 1] ?? fail(inputError(`the document has no page ${number}`));
        const how = renderPlan(pdfPage, A4_PT, A4.dpi);
        const rendered = await deps.render.pdfPage(source, number, how.dpi);
        const upright = how.rotate ? rotateLeft(rendered) : rendered;
        const placed = placeRendered(upright, sheet);
        page = placed.page;
        info = { page: number, placement: placed.placement, rotated: how.rotate, renderedDpi: how.dpi, source: { width: rendered.width, height: rendered.height } };
      } else {
        const image = deps.render.image(file.bytes);
        const placed = placeImage(image, sheet);
        page = placed.page;
        info = { page: number, placement: placed.placement, rotated: placed.rotated, source: { width: image.width, height: image.height } };
      }
      if (luts !== undefined) applyLuts(page.pixels, page.width, luts);
      if (args.dryRun) previews.push(await deps.outbox.save(`${outDir}/${stem}-p${number}-preview.png`, deps.render.png(preview(page, PREVIEW_FACTOR))));
      encoded.push(await scratch.write(`page-${i}.pwgdata`, encodePage(page)));
      prepared.push(info);
    }

    const document = await pwgDocument(scratch, encoded, args.copies, sheet);

    const summary = {
      file: { name: file.name, sha256: file.sha256, size: file.size, kind },
      pages: prepared,
      copies: args.copies,
      sheets,
      correction: luts === undefined ? "off" : "on",
      ...(luts === undefined || calibration === undefined ? {} : { calibration_points: calibration.points.length }),
      raster: { dpi: A4.dpi, width: sheet.width, height: sheet.height, type: "sgray_8", bytes: document.size },
    };
    if (args.dryRun) {
      const pwg = await deps.outbox.save(`${outDir}/${stem}.pwg`, document);
      return { dry_run: true, printed: false, ...summary, pwg, previews };
    }

    return { ...(await sendAndWait(deps, document, args.jobName?.trim() || stem, sheets)), ...summary };
  } finally {
    await scratch.dispose();
  }
};
