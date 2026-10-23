import { sha256Of } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../../domain/errors.js";
import { parseUploadId } from "../../domain/ids.js";
import { accountProblems, type InvoiceReading, sellerProblems } from "../../domain/invoiceXml.js";
import { statusReceipt, uploadReceipt } from "../../domain/receipts.js";
import { parseStandard } from "../../domain/upload.js";
import { uploadSummary } from "../../domain/uploadSummary.js";
import { resolveCif } from "../cif.js";
import type { Deps } from "../ports.js";
import { filed } from "./filed.js";
import type { DocumentRead } from "./inputFiles.js";

/** ANAF's /upload refuses anything over 10 MB (its own published example). */
export const MAX_XML_BYTES = 10 * 1024 * 1024;

/**
 * File an invoice XML.
 *
 * The use case takes the document as the TEXT read from the caller's file
 * (by path, or as base64 checked against its sha256: mcp/uploadArgs.ts), read
 * ONCE before anything else, by the policy's `resolve`: the line a user
 * confirms and this upload get the same text, decoded strictly from the file's
 * bytes, and `read` says which file that was and what it hashed to. The bytes
 * filed are checked against that hash once more before they are sent.
 *
 * `test` defaults to true at every layer above this one. A production upload is
 * a filing with the tax authority: it cannot be recalled, it is visible to the
 * counterparty, and the only way back is a credit note.
 *
 * `invoice` in the result is what the XML says it is, read by the same
 * function that wrote the line a user confirmed.
 *
 * Before anything is sent: every IBAN the document names must pass its check
 * digits (`uploadProblems`), and a production upload of bytes already sent to
 * production is refused unless `refile` (domain/uploadLedger.ts), because a
 * lost answer followed by a retry would otherwise file the invoice twice.
 *
 * `b2c` sends it to /uploadb2c instead, ANAF's endpoint for an invoice to a
 * person: the same parameters, the same answer, the same ledger and the same
 * confirmation line, marked B2C (upload_invoice_b2c).
 */
export type UploadInvoiceArgs = {
  readonly xml: string;
  /** The file the text came from; absent only for a caller inside this process (a test). */
  readonly read?: DocumentRead | undefined;
  readonly cif: string;
  readonly standard: string;
  readonly extern: boolean;
  readonly autofactura: boolean;
  readonly executare: boolean;
  readonly test: boolean;
  /** File again bytes already sent to production. */
  readonly refile?: boolean | undefined;
  /** An invoice to a person, filed through /uploadb2c (upload_invoice_b2c). */
  readonly b2c?: boolean | undefined;
};

/** What makes a document unfit to file, found before anyone is asked to confirm it. */
export const uploadProblems = (reading: InvoiceReading): readonly string[] =>
  reading.kind === "invoice" ? [...accountProblems(reading.facts), ...sellerProblems(reading.facts)] : [];

export const ensureUploadable = (reading: InvoiceReading): void => {
  const problems = uploadProblems(reading);
  if (problems.length > 0) fail(inputError(`the invoice was not sent: ${problems.join("; ")}`));
};

export const uploadInvoice = async (deps: Deps, args: UploadInvoiceArgs) => {
  const xml = Buffer.from(args.xml, "utf8");
  if (xml.length === 0) fail(inputError("the invoice XML is empty"));
  if (xml.length > MAX_XML_BYTES) fail(inputError(`the invoice XML is ${xml.length} bytes; ANAF refuses anything over 10 MB`));
  const sha256 = sha256Of(xml);
  if (args.read !== undefined && args.read.sha256 !== sha256)
    fail(inputError(`the text to file hashes to ${sha256}, not to the ${args.read.sha256} of ${args.read.name}; nothing was sent`));
  const cif = await resolveCif(deps, args.cif);
  const reading = deps.readInvoice(args.xml);
  ensureUploadable(reading);
  const send = async () => {
    const { header, raw } = await deps.anaf.uploadInvoice({
      cif,
      xml,
      standard: parseStandard(args.standard),
      flags: { extern: args.extern, autofactura: args.autofactura, executare: args.executare },
      test: args.test,
      b2c: args.b2c === true,
    });
    return uploadReceipt(header, raw);
  };
  const entry = { sha256, cif, at: new Date(deps.now() * 1000).toISOString(), kind: args.b2c === true ? ("b2c" as const) : ("invoice" as const) };
  const receipt = args.test ? await send() : await filed(deps, entry, args.refile === true, send);
  return {
    ok: true,
    environment: args.test ? "test" : "production",
    ...(args.b2c === true ? { b2c: true } : {}),
    cif,
    bytes: xml.length,
    sha256,
    ...(args.read === undefined ? {} : { file: args.read }),
    invoice: reading.kind === "invoice" ? reading.facts : { unreadable: reading.why },
    ...receipt,
  };
};

export const uploadStatus = async (deps: Deps, args: { idIncarcare: string; test: boolean }) => {
  const idIncarcare = parseUploadId(args.idIncarcare);
  const { header, raw } = await deps.anaf.uploadStatus(idIncarcare, args.test);
  return {
    ok: true,
    environment: args.test ? "test" : "production",
    idIncarcare,
    ...statusReceipt(header, raw),
  };
};

/**
 * The line a user confirms before an upload runs, from the tool's resolved
 * arguments (the policy parses them with their own schema, defaults applied:
 * mcp/policy.ts). The XML is read by `read`, the same reader `uploadInvoice`
 * reports from, so what a user confirmed and what the result says was filed
 * cannot disagree; the file's sha256 ends the line, so the confirmation names
 * the bytes too. Never throws: a document that cannot be read says so, and
 * the answer to that is no.
 */
export const uploadConfirmationLine = (read: (xml: string) => InvoiceReading, args: UploadInvoiceArgs): string =>
  uploadSummary(read(args.xml), {
    test: args.test,
    standard: args.standard,
    cif: args.cif,
    flags: { extern: args.extern, autofactura: args.autofactura, executare: args.executare },
    sha256: args.read?.sha256 ?? sha256Of(Buffer.from(args.xml, "utf8")),
    refile: args.refile === true,
    b2c: args.b2c === true,
  });
