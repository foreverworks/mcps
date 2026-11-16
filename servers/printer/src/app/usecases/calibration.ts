import type { FileSource } from "@foreverworks/mcp-kit";

import { type Calibration, parseCalibration, sheetsOf } from "../../domain/correction/calibration.js";
import { lateralAt, type Model, fitModel, predict } from "../../domain/correction/model.js";
import { interp } from "../../domain/correction/numeric.js";
import { fail, inputError } from "../../domain/errors.js";
import type { Deps } from "../ports.js";

/**
 * The calibration the correction is computed from: what is loaded, and what
 * the model fitted to it says about the printer.
 */

const round = (v: number, places = 1): number => Math.round(v * 10 ** places) / 10 ** places;

/** The model in a few numbers a person can read: the tone response every 10%, the left-right profile every 20 mm. */
export const describeModel = (model: Model) => ({
  tone_response: Array.from({ length: 11 }, (_, i) => ({ sent: i * 10, printed: round(interp(i * 10, model.responseSent, model.responsePrinted)) })),
  lateral_profile_at_mid_tones: Array.from({ length: 11 }, (_, i) => ({ x_mm: 5 + i * 20, offset: round(lateralAt(model.lateral, 5 + i * 20)) })),
});

/** How far the model is from the points it was fitted to, per sheet: the mean absolute error in coverage points. */
const fitError = (calibration: Calibration, model: Model) =>
  sheetsOf(calibration).map(({ sheet, points }) => {
    const mine = calibration.points.filter((p) => p.sheet === sheet);
    const error = mine.reduce((sum, p) => sum + Math.abs(predict(model, p.sent, p.xMm) - p.printed), 0) / mine.length;
    return { sheet, points, mean_abs_error: round(error, 2) };
  });

const summary = (calibration: Calibration) => {
  const model = fitModel(calibration.points);
  return { note: calibration.note, points: calibration.points.length, sheets: fitError(calibration, model), ...describeModel(model) };
};

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/**
 * The loaded calibration, summed up. With `save`, also the file itself in the
 * outbox: the bytes as stored, which are exactly what `load_calibration`
 * accepts, so a calibration moves to another server by saving it here and
 * loading the file there.
 */
export const showCalibration = async (deps: Deps, args: { readonly save: boolean }) => {
  const calibration = await deps.calibration.load();
  if (calibration === undefined) {
    if (args.save) return fail(inputError("no calibration is loaded, so there is nothing to save; load one with load_calibration or measure a sheet with measure_calibration first"));
    return { loaded: false, path: deps.calibration.path };
  }
  const shown = { loaded: true, path: deps.calibration.path, ...summary(calibration) };
  if (!args.save) return shown;
  const bytes = await deps.calibration.raw();
  if (bytes === undefined) return fail({ kind: "calibration", message: `${deps.calibration.path} was removed while it was being read; call again` });
  return { ...shown, saved: await deps.outbox.save(`calibration/calibration-${stamp(deps.now())}.json`, bytes) };
};

export const loadCalibration = async (deps: Deps, args: { readonly file: FileSource }) => {
  const file = await deps.inputFiles(args.file);
  const parsed = parseCalibration(Buffer.from(file.bytes).toString("utf8"));
  if (!parsed.ok) return fail({ kind: "calibration", message: `${file.name || "the file"} is not a usable calibration: ${parsed.problems.join("; ")}` });
  const described = summary(parsed.calibration);
  await deps.calibration.save(parsed.calibration);
  return { loaded: true, path: deps.calibration.path, from: { name: file.name, sha256: file.sha256, size: file.size }, ...described };
};
