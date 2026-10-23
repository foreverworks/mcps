import type { FileSource, InputFile, InputFiles, ToolArgs } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { readDocumentText } from "../app/usecases/inputFiles.js";
import { ensureUploadable, type UploadInvoiceArgs } from "../app/usecases/uploads.js";
import type { InvoiceReading } from "../domain/invoiceXml.js";
import { fail, inputError } from "../domain/errors.js";
import { STANDARDS } from "../domain/upload.js";
import { documentInput, type FileArg, fileArg } from "./fileArgs.js";

/**
 * `test` defaults to TRUE on both upload tools, the opposite of every read tool.
 *
 * An upload is a filing with the tax authority: it reaches the counterparty, it
 * cannot be withdrawn, and undoing one means issuing a credit note. The default
 * should be the harmless answer to "what if the model got this wrong".
 */
export const testFlag = z.boolean().default(true).describe("TRUE by default. Pass false to file with ANAF for real.");

/** What an upload is, beside the document itself. */
const SETTINGS = {
  cif: z.string().default("").describe("The ISSUER's CIF. Defaults to app.json's company_cif."),
  standard: z.enum(STANDARDS).default("UBL").describe("UBL for an ordinary invoice."),
  extern: z.boolean().default(false).describe("The buyer is foreign and has no Romanian CUI."),
  autofactura: z.boolean().default(false).describe("Self-billing on the supplier's behalf."),
  executare: z.boolean().default(false).describe("Issued under an enforcement procedure."),
  test: testFlag,
  refile: z
    .boolean()
    .default(false)
    .describe(
      "File again a document whose exact bytes were already sent to production. Refused without it, so a retry " +
        "after a lost answer cannot file the invoice twice: check upload_status or list_invoices first.",
    ),
};

const WHAT = "The invoice XML (at most 10 MB)";

/** upload_invoice's arguments, with the file sentences in the reader's own words. */
export const uploadInput = (files: InputFiles) => ({
  xml: fileArg(WHAT, files),
  ...SETTINGS,
});

/**
 * The arguments once `resolveUpload` has read the document: ONE definition,
 * which the policy parses to write the line a user confirms and the tool runs
 * on, so the line describes exactly the call that will run. A call without a
 * document never gets here: `resolveUpload` refuses it before anyone is asked.
 */
export const resolvedUploadArgs = z.object({
  ...SETTINGS,
  xml: z.string().min(1),
  xml_read: z.object({ name: z.string(), size: z.number(), sha256: z.string(), path: z.string().optional() }),
});

export const toUploadArgs = (args: z.infer<typeof resolvedUploadArgs>): UploadInvoiceArgs => ({
  xml: args.xml,
  read: args.xml_read,
  cif: args.cif,
  standard: args.standard,
  extern: args.extern,
  autofactura: args.autofactura,
  executare: args.executare,
  test: args.test,
  refile: args.refile,
});

/**
 * The upload's arguments with the document read: the file by path, or the
 * script's base64 checked against its sha256 (mcp-kit), as the text the upload
 * files and the line a user confirms, and checked for what would make it unfit
 * to file (an IBAN that fails its check digits). The policy's `resolve` for
 * upload_invoice, and idempotent, so the tool runs it again for a call that
 * did not pass the gate (a test, a direct registration).
 */
export const resolveUpload = async (
  readInput: (source: FileSource) => Promise<InputFile>,
  readInvoice: (xml: string) => InvoiceReading,
  args: ToolArgs,
): Promise<ToolArgs> => {
  if (typeof args["xml"] === "string" && args["xml_read"] !== undefined) return args;
  const { xml, ...rest } = args;
  const arg = typeof xml === "object" && xml !== null ? (xml as FileArg) : undefined;
  const document = await readDocumentText(readInput, documentInput("xml", arg));
  if (document === undefined) return fail(inputError("give the invoice as xml: { path } for a file, or { content_base64, sha256 } from a script"));
  // Refused here, before anyone is asked to confirm an invoice that cannot be filed as it stands.
  ensureUploadable(readInvoice(document.text));
  return { ...rest, xml: document.text, xml_read: document.read };
};
