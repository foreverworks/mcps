import { parseStamp } from "./messages.js";
import type { StatusHeader, UploadHeader } from "./schema.js";

/**
 * `/upload` and `/stareMesaj` answer one `<header>` element whose attributes
 * are the whole result. The infra layer parses the XML into ANAF's generated
 * `Header` types; these read the typed header into a verdict.
 *
 * The XML is carried through on every result. These are filings: if this
 * reader ever misses something ANAF said, the sentence it missed is still there
 * to read.
 */

const errorsOf = (errors: readonly { readonly errorMessage?: string }[] | undefined): readonly string[] =>
  (errors ?? []).flatMap((e) => (e.errorMessage === undefined ? [] : [e.errorMessage]));

/**
 * `ExecutionStatus` is 0 for accepted and 1 for refused, and it is the only
 * field that says which. An `index_incarcare` is present exactly when accepted.
 */
export type UploadReceipt = {
  readonly accepted: boolean;
  readonly uploadId: string | undefined;
  /** `dateResponse`, zoneless Bucharest local like every ANAF stamp. */
  readonly respondedAtLocal: string | undefined;
  readonly errors: readonly string[];
  readonly raw: string;
};

export const uploadReceipt = (header: UploadHeader, raw: string): UploadReceipt => ({
  // Trusting the id alone would call a refusal accepted the day ANAF starts
  // echoing one back with an error; trusting the status alone would call an
  // answer without an id accepted, and upload_status needs that id.
  accepted: header.executionStatus === 0 && header.indexIncarcare !== undefined,
  uploadId: header.indexIncarcare === undefined ? undefined : String(header.indexIncarcare),
  respondedAtLocal: parseStamp(header.dateResponse),
  errors: errorsOf(header.errors),
  raw,
});

/**
 * `stare` is `ok`, `nok`, `in prelucrare` (still processing), or `XML cu erori
 * nepreluat de sistem` (refused before processing), per the published
 * examples. A download id appears with `ok` and with `nok` (the errors).
 */
export type ProcessingState = "ok" | "failed" | "processing" | "unknown";

const STATES: Readonly<Record<string, ProcessingState>> = {
  ok: "ok",
  nok: "failed",
  "in prelucrare": "processing",
  "xml cu erori nepreluat de sistem": "failed",
};

export type StatusReceipt = {
  readonly state: ProcessingState;
  /** ANAF's own word, kept because `state` collapses anything unrecognised. */
  readonly stare: string | undefined;
  readonly downloadId: string | undefined;
  readonly errors: readonly string[];
  readonly raw: string;
};

export const statusReceipt = (header: StatusHeader, raw: string): StatusReceipt => ({
  state: STATES[(header.stare ?? "").trim().toLowerCase()] ?? "unknown",
  stare: header.stare,
  downloadId: header.idDescarcare,
  errors: errorsOf(header.errors),
  raw,
});
