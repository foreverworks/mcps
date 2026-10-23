import type { Point } from "./model.js";

/**
 * A printer's calibration: every measured patch, as a file a person can read
 * and a tool can extend.
 *
 *     { "note": "...", "points": [[sheet, sent %, x mm, printed %], ...] }
 *
 * `sheet` names the page a patch was measured on, `sent` the coverage the
 * printer was sent (0 paper .. 100 black), `x` the patch's centre in mm from
 * the left paper edge, `printed` the coverage measured on paper (normalised
 * so the paper is 0 and the printer's solid black 100; a little outside that
 * range is measurement noise and is kept).
 */
export type Calibration = { readonly note: string; readonly points: readonly Point[] };

export type Parsed = { readonly ok: true; readonly calibration: Calibration } | { readonly ok: false; readonly problems: readonly string[] };

/** The widest page this models, in mm (US Letter is 215.9). */
const MAX_X_MM = 220;

/** Fewer than this many points in mid tones cannot pin a degree-4 profile. */
export const MIN_LATERAL_POINTS = 10;

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const parseCalibration = (text: string): Parsed => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { ok: false, problems: [`not JSON: ${(cause as SyntaxError).message}`] };
  }
  if (typeof json !== "object" || json === null || !Array.isArray((json as { points?: unknown }).points)) {
    return { ok: false, problems: ['expected an object with "points": [[sheet, sent %, x mm, printed %], ...]'] };
  }
  const raw = (json as { points: unknown[]; note?: unknown }).points;
  const problems: string[] = [];
  const points: Point[] = [];
  raw.forEach((p, i) => {
    if (!Array.isArray(p) || p.length !== 4) {
      problems.push(`point ${i}: not [sheet, sent %, x mm, printed %]`);
      return;
    }
    const [sheet, sent, xMm, printed] = p as unknown[];
    if (typeof sheet !== "string" || sheet.trim() === "") problems.push(`point ${i}: sheet must be a name`);
    else if (!isNumber(sent) || sent < 0 || sent > 100) problems.push(`point ${i}: sent must be 0..100`);
    else if (!isNumber(xMm) || xMm < 0 || xMm > MAX_X_MM) problems.push(`point ${i}: x must be 0..${MAX_X_MM} mm`);
    else if (!isNumber(printed) || printed < -20 || printed > 120) problems.push(`point ${i}: printed must be a coverage %, about 0..100`);
    else points.push({ sheet, sent, xMm, printed });
  });
  if (problems.length > 0) return { ok: false, problems: problems.slice(0, 20) };
  const lateral = points.filter((p) => p.sent >= 25 && p.sent <= 85).length;
  if (lateral < MIN_LATERAL_POINTS) {
    return { ok: false, problems: [`only ${lateral} points between 25 and 85% sent; the left-right profile needs at least ${MIN_LATERAL_POINTS}`] };
  }
  const note = (json as { note?: unknown }).note;
  return { ok: true, calibration: { note: typeof note === "string" ? note : "", points } };
};

export const calibrationText = (calibration: Calibration): string =>
  `${JSON.stringify(
    { note: calibration.note, points: calibration.points.map((p) => [p.sheet, p.sent, p.xMm, p.printed]) },
    null,
    0,
  )}\n`;

/** How many points each sheet gave, in the order they first appear. */
export const sheetsOf = (calibration: Calibration): readonly { readonly sheet: string; readonly points: number }[] => {
  const counts = new Map<string, number>();
  for (const p of calibration.points) counts.set(p.sheet, (counts.get(p.sheet) ?? 0) + 1);
  return [...counts].map(([sheet, points]) => ({ sheet, points }));
};
