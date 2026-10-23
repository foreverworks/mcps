import { resolveSaveDir } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../../domain/errors.js";
import { parseMessageId } from "../../domain/ids.js";
import { MAX_VALIDATION_BYTES, pdfName, validationTarget, verdictOf } from "../../domain/validation.js";
import type { Deps } from "../ports.js";
import { digestsOf, fetchArchive, invoiceInArchive } from "./archive.js";
import { type DocumentInput, given, readDocumentText } from "./inputFiles.js";

const sized = (xml: string): string => {
  const bytes = Buffer.byteLength(xml, "utf8");
  if (bytes === 0) fail(inputError("the XML is empty"));
  if (bytes > MAX_VALIDATION_BYTES) fail(inputError(`the XML is ${bytes} bytes; ANAF refuses anything over 5 MB`));
  return xml;
};

/**
 * ANAF's own verdict on a UBL invoice or credit note, before it is filed:
 * the same schema and Schematron rules /upload applies, without filing
 * anything. `invoice` is what the document says it is, and `file` which file
 * that was (name, size, sha256), so a result cannot be mistaken for another
 * invoice's.
 */
export const validateInvoice = async (deps: Deps, args: { readonly xml: DocumentInput }) => {
  const document = await readDocumentText(deps.files.readInput, args.xml);
  if (document === undefined) return fail(inputError("give the invoice as xml: { path } for a file, or { content_base64, sha256 } from a script"));
  const xml = sized(document.text);
  const { standard, facts } = validationTarget(deps.readInvoice(xml));
  return { ...verdictOf(await deps.anaf.validate(xml, standard)), standard, invoice: facts, file: document.read };
};

export type InvoicePdfArgs = {
  readonly messageId: string;
  readonly xml: DocumentInput;
  readonly validate: boolean;
  readonly saveDir: string;
  readonly test: boolean;
};

/** Exactly one of the two sources: a filed message, or a document. */
const sourceOf = async (deps: Deps, args: InvoicePdfArgs) => {
  if (args.messageId !== "" && given(args.xml)) return fail(inputError("give message_id or xml, not both"));
  if (args.messageId !== "") {
    const messageId = parseMessageId(args.messageId);
    const xml = invoiceInArchive(deps, messageId, await fetchArchive(deps, messageId, args.test));
    return { xml, name: messageId, filed: true, file: undefined };
  }
  const document = await readDocumentText(deps.files.readInput, args.xml);
  if (document !== undefined) return { xml: sized(document.text), name: undefined, filed: false, file: document.read };
  return fail(inputError("give message_id (a filed invoice), or a document as xml: { path } for a file, or { content_base64, sha256 } from a script"));
};

/**
 * ANAF's PDF of an invoice, saved to the downloads outbox (or a folder under
 * it) as `<message id>.pdf` or `<invoice number>.pdf` (numbered when that
 * name holds another file), with the PDF's size, sha256 and md5.
 *
 * A filed invoice is converted WITHOUT validating it again: ANAF validated it
 * when it was filed, and today's rules refusing a PDF of a legal document
 * filed under last year's would help nobody. A document that is not filed is
 * validated first unless `validate` is false; when it fails, the result says
 * why instead of saving anything.
 */
export const invoicePdf = async (deps: Deps, args: InvoicePdfArgs) => {
  const where = resolveSaveDir(deps.paths.downloadsDir, args.saveDir);
  if (!where.ok) return fail(inputError(where.reason));
  const source = await sourceOf(deps, args);
  const { standard, facts } = validationTarget(deps.readInvoice(source.xml));
  const validated = source.filed ? false : args.validate;
  const name = pdfName(source.name ?? facts.number ?? "invoice");
  const answer = await deps.anaf.convert(source.xml, standard, validated);
  const from = source.file === undefined ? {} : { file: source.file };
  if ("refusal" in answer) return { saved: false, standard, validated, invoice: facts, ...from, ...verdictOf(answer.refusal) };
  return {
    saved: true,
    path: await deps.files.writeFile(where.dir, name, answer.pdf),
    bytes: answer.pdf.length,
    ...digestsOf(answer.pdf),
    standard,
    validated,
    invoice: facts,
    ...from,
  };
};
