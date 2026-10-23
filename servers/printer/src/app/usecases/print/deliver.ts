import { asAppError, fail } from "../../../domain/errors.js";
import { FINAL_JOB_STATES, type JobStatus } from "../../../domain/ipp/operations.js";
import { A4, pageHeader, SYNC_WORD } from "../../../domain/pwg.js";
import type { Size } from "../../../domain/raster.js";
import type { Deps, Scratch } from "../../ports.js";

/**
 * Getting encoded pages onto paper: the document assembled from the pages on
 * disk, the printer checked, the job sent and followed to its end. Shared by
 * print and calibration_sheet.
 */

const POLL_MS = 2_000;

/** How long to wait for the printer to finish: a minute, and 15 s a sheet, at most 10 minutes. */
export const waitBudgetMs = (sheets: number): number => Math.min(600_000, 60_000 + 15_000 * sheets);

const wait = async (
  deps: Deps,
  job: JobStatus,
  budgetMs: number,
): Promise<{ readonly job: JobStatus; readonly waitedMs: number; readonly finished: boolean; readonly lost?: string }> => {
  const started = deps.now();
  let last = job;
  while (!FINAL_JOB_STATES.has(last.state as never)) {
    if (deps.now() - started > budgetMs) return { job: last, waitedMs: deps.now() - started, finished: false };
    await deps.sleep(POLL_MS);
    try {
      last = await deps.printer.job(job.jobId);
    } catch (thrown) {
      // the job was taken: losing sight of it must not lose its number, or someone prints it twice
      const known = asAppError(thrown);
      if (known === undefined) throw thrown;
      return { job: last, waitedMs: deps.now() - started, finished: false, lost: known.message };
    }
  }
  return { job: last, waitedMs: deps.now() - started, finished: true };
};

/** The printer must be taking jobs, or nothing is rendered for it. */
export const ready = async (deps: Deps): Promise<void> => {
  const status = await deps.printer.status();
  if (status.acceptingJobs === false || status.state === "stopped") {
    const why = status.reasons.map((r) => r.meaning ?? r.reason).join(", ");
    return fail({ kind: "busy", device: "printer", message: `the printer is ${status.state} and ${status.acceptingJobs === false ? "not accepting jobs" : "stopped"}${why ? `: ${why}` : ""}` });
  }
};

/** The PWG document: the sync word, then for each copy every page's header and lines, read from disk as it is sent. */
export const pwgDocument = async (scratch: Scratch, encoded: readonly string[], copies: number, sheet: Size): Promise<Blob> => {
  const header = new Uint8Array(pageHeader(sheet, A4, encoded.length * copies));
  const blobs = await Promise.all(encoded.map((path) => scratch.blob(path)));
  const parts: (string | Uint8Array | Blob)[] = [SYNC_WORD];
  for (let copy = 0; copy < copies; copy += 1) for (const blob of blobs) parts.push(header, blob);
  return new Blob(parts, { type: "image/pwg-raster" });
};

/** Print-Job, then the job followed to its end; a send cut off says the job may exist, a job lost from sight keeps its number. */
export const sendAndWait = async (deps: Deps, document: Blob, jobName: string, sheets: number) => {
  const submitted = await deps.printer
    .submit({ jobName, documentFormat: "image/pwg-raster" }, document, waitBudgetMs(sheets))
    .catch((thrown: unknown) => {
      const known = asAppError(thrown);
      // cut off while sending: the printer may have taken it and be printing
      return known?.kind === "unreachable"
        ? fail({ ...known, message: `${known.message} while the document was being sent; the printer may have taken it: call job before printing again` })
        : Promise.reject(thrown);
    });
  const done = await wait(deps, submitted, waitBudgetMs(sheets));
  return {
    printed: done.job.state === "completed",
    job: done.job,
    finished: done.finished,
    waited_seconds: Math.round(done.waitedMs / 1000),
    ...(done.finished
      ? {}
      : { note: done.lost === undefined ? "the printer is still working on it; call job with this job_id to follow it" : `lost sight of the job (${done.lost}); call job with this job_id before printing again` }),
  };
};
