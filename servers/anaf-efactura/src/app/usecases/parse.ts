import { sha256Of } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import { archiveContents, outboxArchive } from "./archive.js";
import { type DocumentInput, given, readDocumentText, utf8Of } from "./inputFiles.js";

export type ParseInvoiceArgs = {
  /** The document by path, or as a script's base64 checked against its sha256. */
  readonly xml: DocumentInput;
  /** Or an archive download_invoice saved to the outbox: its name, or its path under the outbox. */
  readonly archive: string;
};

/** The document's text and where it came from: a file read byte-exact, or the one invoice in an archive in the outbox. */
const sourceOf = async (deps: Deps, args: ParseInvoiceArgs) => {
  if (given(args.xml) === (args.archive !== "")) {
    return fail(inputError("give one of: xml ({ path } for a file, or { content_base64, sha256 } from a script), or archive (a .zip download_invoice saved)"));
  }
  if (args.archive !== "") {
    const path = outboxArchive(deps, args.archive);
    const bytes = await deps.files.readFile(path);
    const { invoice } = archiveContents(deps, path, bytes);
    return { text: utf8Of(invoice, `the invoice in ${path}`), source: { archive: { path, sha256: sha256Of(bytes), bytes: bytes.length } } };
  }
  const document = await readDocumentText(deps.files.readInput, args.xml);
  if (document === undefined) return fail(inputError("give the invoice as xml: { path } for a file, or { content_base64, sha256 } from a script"));
  return { text: document.text, source: { file: document.read } };
};

/**
 * A UBL invoice or credit note as plain JSON (domain/invoiceView.ts): parties,
 * lines, VAT, totals and payment terms, every value the text the document
 * holds. Reads only: nothing is sent to ANAF, and an archive is read from the
 * outbox, never downloaded again.
 */
export const parseInvoice = async (deps: Deps, args: ParseInvoiceArgs) => {
  const { text, source } = await sourceOf(deps, args);
  const reading = deps.viewInvoice(text);
  if (reading.kind === "unreadable") return fail(inputError(`the document cannot be read as a UBL invoice: ${reading.why}`));
  return { ...source, invoice: reading.view };
};
