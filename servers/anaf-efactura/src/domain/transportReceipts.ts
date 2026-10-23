import { parseStamp } from "./messages.js";
import type { ProcessingState } from "./receipts.js";
import type { RawTransportStatus, RawTransportUpload } from "./schema.js";

/**
 * e-Transport's answers, read into verdicts. Unlike e-Factura's XML header,
 * both are JSON (upload_param.html and stare.html, 02.07.2024): an upload
 * answers `ExecutionStatus` 0 with the `index_incarcare` etransport_status
 * takes and the UIT, or 1 with `Errors`; a status answers `stare`.
 */

const errorsOf = (errors: readonly { readonly errorMessage?: string }[] | undefined): readonly string[] =>
  (errors ?? []).flatMap((e) => (e.errorMessage === undefined ? [] : [e.errorMessage]));

export type TransportReceipt = {
  readonly accepted: boolean;
  readonly uploadId: string | undefined;
  /** The UIT ANAF issued (a new declaration) or echoed. Valid only once etransport_status says ok. */
  readonly uit: string | undefined;
  readonly reference: string | undefined;
  readonly respondedAtLocal: string | undefined;
  readonly errors: readonly string[];
  /** ANAF's `atentie`: the UIT counts only once its status is ok. */
  readonly notice: string | undefined;
};

export const transportReceipt = (raw: RawTransportUpload): TransportReceipt => ({
  // As uploadReceipt: the status and the id together, never one alone.
  accepted: raw.ExecutionStatus === 0 && raw.index_incarcare !== undefined,
  uploadId: raw.index_incarcare === undefined ? undefined : String(raw.index_incarcare),
  uit: raw.UIT === "" ? undefined : raw.UIT,
  reference: raw.ref_declarant === "" ? undefined : raw.ref_declarant,
  respondedAtLocal: parseStamp(raw.dateResponse),
  errors: errorsOf(raw.Errors),
  notice: raw.atentie,
});

const STATES: Readonly<Record<string, ProcessingState>> = {
  ok: "ok",
  nok: "failed",
  "in prelucrare": "processing",
  "xml cu erori nepreluat de sistem": "failed",
};

export type TransportStatus = {
  readonly state: ProcessingState;
  /** ANAF's own word, kept because `state` collapses anything unrecognised. */
  readonly stare: string | undefined;
  readonly respondedAtLocal: string | undefined;
  readonly errors: readonly string[];
};

export const transportStatus = (raw: RawTransportStatus): TransportStatus => ({
  state: STATES[(raw.stare ?? "").trim().toLowerCase()] ?? "unknown",
  stare: raw.stare,
  respondedAtLocal: parseStamp(raw.dateResponse),
  errors: errorsOf(raw.Errors),
});
