import type { RawMessage, RawMessageList, RawPagedMessageList } from "./schema.js";

/**
 * What a message in the e-Factura mailbox is, once ANAF's wire shape is behind
 * us.
 *
 * Everything here is a pure function of one raw row. No I/O, no clock: the same
 * row maps to the same message forever, which is what makes the awkward parts
 * below testable without an account.
 */

/** ANAF's four message types, and the honest fifth. */
export type MessageKind = "sent" | "received" | "error" | "buyerMessage" | "unknown";

const KINDS: Record<string, MessageKind> = {
  "FACTURA TRIMISA": "sent",
  "FACTURA PRIMITA": "received",
  "ERORI FACTURA": "error",
  "MESAJ CUMPARATOR": "buyerMessage",
};

export const messageKind = (tip: string | undefined): MessageKind => KINDS[(tip ?? "").trim()] ?? "unknown";

const STAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/;

/**
 * `202601151234` to `2026-01-15T12:34`, and e-Transport's `20221010144008`
 * (with seconds) to `2022-10-10T14:40:08`.
 *
 * Deliberately zoneless. The stamp is Bucharest local and ANAF never says so in
 * the payload, so appending a `Z` would move every timestamp by an hour or two
 * and appending `+02:00` would be wrong for half the year. A reader who needs an
 * instant has to supply the zone they believe in.
 */
export const parseStamp = (stamp: string | undefined): string | undefined => {
  const match = STAMP.exec((stamp ?? "").trim());
  if (match === null) return undefined;
  const [, y, m, d, hh, mm, ss] = match;
  return `${y}-${m}-${d}T${hh}:${mm}${ss === undefined ? "" : `:${ss}`}`;
};

/**
 * `detalii` is prose with identifiers buried in it:
 *
 *   "Factura cu id_incarcare=5001234567 emisa de cif_emitent=92345672
 *    pentru cif_beneficiar=87654329"
 *
 * Those three are the only machine-readable facts ANAF puts in a listing, and
 * the counterparty CIF in particular is what a ledger needs to reconcile
 * against. Leaving them inside a sentence makes every consumer write this regex.
 */
export type MessageDetails = {
  readonly uploadId?: string | undefined;
  readonly issuerCif?: string | undefined;
  readonly beneficiaryCif?: string | undefined;
};

const field = (text: string, name: string): string | undefined =>
  new RegExp(`${name}\\s*=\\s*([A-Za-z0-9]+)`).exec(text)?.[1];

export const parseDetails = (detalii: string | undefined): MessageDetails => {
  const text = detalii ?? "";
  return {
    uploadId: field(text, "id_incarcare"),
    issuerCif: field(text, "cif_emitent"),
    beneficiaryCif: field(text, "cif_beneficiar"),
  };
};

export type InvoiceMessage = {
  /** The download id, which is what `download_invoice` takes. */
  readonly id: string | undefined;
  readonly requestId: string | undefined;
  readonly kind: MessageKind;
  /** ANAF's own label, kept because `kind` collapses anything unrecognised. */
  readonly type: string | undefined;
  readonly createdAtLocal: string | undefined;
  readonly cif: string | undefined;
  readonly details: MessageDetails;
  /** The sentence the ids were read out of, for a human reading the list. */
  readonly description: string | undefined;
};

export const invoiceMessage = (raw: RawMessage): InvoiceMessage => ({
  id: raw.id,
  requestId: raw.id_solicitare,
  kind: messageKind(raw.tip),
  type: raw.tip,
  createdAtLocal: parseStamp(raw.data_creare),
  cif: raw.cif,
  details: parseDetails(raw.detalii),
  description: raw.detalii,
});

/**
 * ANAF answers some refusals with HTTP 200 and an `eroare` key. A listing that
 * reported those as "no invoices" would be the most expensive kind of wrong, so
 * the mapper surfaces it rather than mapping an absent `mesaje` to `[]`.
 */
export type MessageListing = {
  readonly count: number;
  readonly messages: readonly InvoiceMessage[];
  readonly notice: string | undefined;
};

/**
 * `cui` is deliberately NOT carried through.
 *
 * It is not the company CIF despite the name: on a real response it comes back
 * as "<CNP>,<CIF>", the personal identification number from the signing
 * certificate followed by the company's code. The caller already knows which CIF it asked for, so
 * echoing it buys nothing and puts a personal identification number into every
 * transcript that lists invoices. Each MESSAGE still carries its own `cif`,
 * which is the company one and is useful.
 */
export const messageListing = (raw: RawMessageList): MessageListing => ({
  count: raw.mesaje?.length ?? 0,
  messages: (raw.mesaje ?? []).map(invoiceMessage),
  notice: raw.eroare,
});

export type PagedMessageListing = MessageListing & {
  readonly page: number | undefined;
  readonly totalPages: number | undefined;
  readonly totalRecords: number | undefined;
};

export const pagedMessageListing = (raw: RawPagedMessageList): PagedMessageListing => ({
  ...messageListing(raw),
  page: raw.index_pagina_curenta,
  totalPages: raw.numar_total_pagini,
  totalRecords: raw.numar_total_inregistrari,
});
