import type { FileSource } from "@foreverworks/mcp-kit";

import { type Calibration, MIN_LATERAL_POINTS, sheetsOf } from "../../domain/correction/calibration.js";
import { measureSheet } from "../../domain/correction/measure.js";
import { fitModel, type Model, type Point, predict } from "../../domain/correction/model.js";
import { renderSheet, sheetLayout } from "../../domain/correction/sheet.js";
import { fail, inputError } from "../../domain/errors.js";
import { documentKind } from "../../domain/pages.js";
import { A4, encodePage, type GreyPage } from "../../domain/pwg.js";
import { a4At, preview } from "../../domain/raster.js";
import type { Deps } from "../ports.js";
import { describeModel } from "./calibration.js";
import { pwgDocument, ready, sendAndWait } from "./print/deliver.js";

/**
 * Calibrating a printer from nothing: print the calibration sheet with no
 * correction, scan it on a flatbed, measure the scan. The measured patches
 * join the calibration and the model is fitted again, so the next print is
 * corrected by them. A sheet is identified by its name: its layout is made
 * from the name, so nothing about it needs keeping between the print and the
 * measurement.
 */

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;

const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");

const SCAN_DPI = 300;

export const printCalibrationSheet = async (deps: Deps, args: { readonly sheet?: string | undefined; readonly dryRun: boolean }) => {
  const sheet = args.sheet?.trim() || `cal-${stamp(deps.now())}`;
  if (!NAME.test(sheet)) return fail(inputError("sheet is a name of letters, digits, dot, dash or underscore, at most 48 characters"));
  const existing = await deps.calibration.load();
  if (existing?.points.some((p) => p.sheet === sheet)) return fail(inputError(`the calibration already has a sheet named ${sheet}; choose another name`));
  const layout = sheetLayout(sheet);
  const size = a4At(A4.dpi);
  const page = renderSheet(layout, size, A4.dpi);
  const next =
    `place the printed sheet face down on the scanner's glass, flat, its top edge against the glass's starting corner (either way up works), ` +
    `then scan it (300 dpi, grey, pdf) and call measure_calibration with sheet "${sheet}" and the scan's path`;
  const summary = { sheet, patches: layout.patches.filter((p) => p.kind === "tone").length, correction: "off" };
  if (args.dryRun) {
    const outDir = `calibration/${sheet}`;
    const saved = await deps.outbox.save(`${outDir}/${sheet}-preview.png`, deps.render.png(preview(page, 5)));
    return { dry_run: true, printed: false, ...summary, preview: saved };
  }
  await ready(deps);
  const scratch = await deps.scratch();
  try {
    const document = await pwgDocument(scratch, [await scratch.write("sheet.pwgdata", encodePage(page))], 1, size);
    return { ...(await sendAndWait(deps, document, `calibration ${sheet}`, 1)), ...summary, next };
  } finally {
    await scratch.dispose();
  }
};

const meanError = (model: Model, points: readonly Point[]): number =>
  Math.round((points.reduce((s, p) => s + Math.abs(predict(model, p.sent, p.xMm) - p.printed), 0) / points.length) * 100) / 100;

/** The scan as a grey page: the server's own scan by its path, or a file given the usual way. */
const scanPage = async (deps: Deps, args: { readonly scan?: string | undefined; readonly file?: FileSource | undefined }): Promise<GreyPage> => {
  if ((args.scan === undefined) === (args.file === undefined)) return fail(inputError("give the scan one way: scan, the path scan answered, or file"));
  const bytes = args.scan !== undefined ? (await deps.outbox.read(args.scan)).bytes : (await deps.inputFiles(args.file as FileSource)).bytes;
  const kind = documentKind(bytes) ?? fail(inputError("the scan is not a PDF, PNG or JPEG"));
  if (kind !== "pdf") return deps.render.image(bytes);
  const scratch = await deps.scratch();
  try {
    return await deps.render.pdfPage(await scratch.write("scan.pdf", bytes), 1, SCAN_DPI);
  } finally {
    await scratch.dispose();
  }
};

export const measureCalibration = async (
  deps: Deps,
  args: { readonly sheet: string; readonly scan?: string | undefined; readonly file?: FileSource | undefined; readonly add: boolean; readonly replace: boolean },
) => {
  if (!NAME.test(args.sheet)) return fail(inputError("sheet is the name calibration_sheet printed it under"));
  const page = await scanPage(deps, args);
  const measured = measureSheet(sheetLayout(args.sheet), page);
  if (!measured.ok) return fail({ kind: "calibration", message: measured.problem });
  const before = await deps.calibration.load();
  const kept: readonly Point[] = before?.points.filter((p) => p.sheet !== args.sheet) ?? [];
  if (args.add && !args.replace && kept.length !== (before?.points.length ?? 0)) {
    return fail(inputError(`the calibration already has points from sheet ${args.sheet}; pass replace: true to measure it again`));
  }
  const after: Calibration = {
    note: before?.note || "every measured patch: [sheet, sent input %, x mm from the left paper edge, printed coverage %]; model = tone response R + lateral profile D(x)",
    points: [...kept, ...measured.points],
  };
  if (after.points.filter((p) => p.sent >= 25 && p.sent <= 85).length < MIN_LATERAL_POINTS) return fail({ kind: "calibration", message: "too few mid-tone patches were measured to fit the left-right profile" });
  const model = fitModel(after.points);
  const result = {
    sheet: args.sheet,
    measured: {
      points: measured.points.length,
      page_turned: measured.located.turned,
      marks_fit_mm: Math.round(measured.located.residualMm * 100) / 100,
      paper_level: Math.round(measured.paper),
      black_level: Math.round(measured.black),
      // how far the calibration as it was would have predicted this sheet, and the one with it
      error_before: before === undefined ? null : meanError(fitModel(before.points), measured.points),
      error_after: meanError(model, measured.points),
    },
    added: args.add,
    points: after.points.length,
    sheets: sheetsOf(after),
    ...describeModel(model),
  };
  if (args.add) await deps.calibration.save(after);
  return result;
};
