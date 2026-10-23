import { type AppError, asAppError, fail, inputError, remedyFor } from "../../domain/errors.js";
import { sheetsOf } from "../../domain/correction/calibration.js";
import type { Deps } from "../ports.js";

/**
 * What the printer and the scanner say about themselves, and whether a
 * calibration is loaded. Each part answers for itself: a scanner that does
 * not answer does not hide what the printer said.
 */

const section = async <T>(read: () => Promise<T>): Promise<T | { readonly ok: false; readonly error: AppError & { readonly remedy: string } }> => {
  try {
    return await read();
  } catch (thrown) {
    const known = asAppError(thrown);
    if (known === undefined) throw thrown;
    return { ok: false, error: { ...known, remedy: remedyFor(known) } };
  }
};

export const status = async (deps: Deps) => {
  const [printer, scanner, calibration] = await Promise.all([
    section(async () => ({ ok: true, ...(await deps.printer.status()) })),
    section(async () => {
      const s = await deps.scanner.status();
      return { ok: true, state: s.state, recent_jobs: s.jobs.slice(-3) };
    }),
    section(async () => {
      const c = await deps.calibration.load();
      return c === undefined ? { loaded: false, path: deps.calibration.path } : { loaded: true, points: c.points.length, sheets: sheetsOf(c).length };
    }),
  ]);
  return { printer, scanner, calibration };
};

/** Failures that mean this integration is broken, not that the printer is off or busy. */
const BROKEN: ReadonlySet<string> = new Set(["config", "tls", "drift", "calibration"]);

const brokenIn = (part: unknown): string | undefined => {
  const error = (part as { readonly error?: { readonly kind?: string; readonly message?: string } }).error;
  return error?.kind !== undefined && BROKEN.has(error.kind) ? `${error.kind}: ${error.message ?? ""}` : undefined;
};

/**
 * Whether this server works, for a monitor: ok unless something here is
 * broken (a setting, a certificate that is not the pinned one, an answer the
 * device should not give, an unreadable calibration). A printer that is
 * switched off or busy is reported, never a failure: at home it often is.
 */
export const health = async (deps: Deps) => {
  const report = await status(deps);
  const problems = [brokenIn(report.printer), brokenIn(report.scanner), brokenIn(report.calibration)].filter((p): p is string => p !== undefined);
  const reachable = (part: unknown): boolean => (part as { readonly ok?: unknown }).ok === true;
  return {
    ok: problems.length === 0,
    ...(problems.length === 0 ? {} : { problems }),
    printer: reachable(report.printer) ? { reachable: true, state: (report.printer as { readonly state: string }).state } : { reachable: false },
    scanner: reachable(report.scanner) ? { reachable: true, state: (report.scanner as { readonly state: string }).state } : { reachable: false },
    calibration: report.calibration,
  };
};

export const job = async (deps: Deps, args: { readonly jobId?: number | undefined; readonly limit: number }) => {
  if (args.jobId !== undefined) return { job: await deps.printer.job(args.jobId) };
  const [active, completed] = await Promise.all([deps.printer.jobs("not-completed", args.limit), deps.printer.jobs("completed", args.limit)]);
  return { active, completed };
};

export const cancelJob = async (deps: Deps, args: { readonly jobId: number }) => {
  if (!Number.isInteger(args.jobId) || args.jobId < 1) return fail(inputError("job_id is the printer's job number, from print or job"));
  await deps.printer.cancel(args.jobId);
  return { cancelled: args.jobId, job: await deps.printer.job(args.jobId) };
};
