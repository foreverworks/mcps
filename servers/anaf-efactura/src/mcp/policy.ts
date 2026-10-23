import { type FileSource, type InputFiles, inputFilesFrom, summaryFrom, type ToolPolicy } from "@foreverworks/mcp-kit";

import { filingConfirmationLine } from "../app/usecases/transports.js";
import { uploadConfirmationLine } from "../app/usecases/uploads.js";
import { withOutbox } from "../infra/files.js";
import { resolvePaths } from "../infra/paths.js";
import { readDeclarationXml, readInvoiceXml } from "../infra/xml.js";
import { resolvedFilingArgs, resolveFiling, toFilingArgs } from "./transportArgs.js";
import { resolvedUploadArgs, resolveUpload, toUploadArgs } from "./uploadArgs.js";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts). `serve` refuses to
 * start if a registered tool is missing here.
 *
 * - read: validate_invoice, parse_invoice, build_invoice, invoice_pdf, verify_signature and
 *   lookup_company file nothing and change nothing at ANAF; invoice_pdf and
 *   build_invoice write into the outbox, as download_invoice does. A built
 *   invoice is a file, not a filing: filing it is upload_invoice's.
 * - write: refreshing rotates the grant, and the two authorization tools
 *   replace it; none of them files anything.
 * - money: an upload (upload_invoice, and upload_invoice_b2c for an invoice to
 *   a person) files a legal document with ANAF (in production), and so does
 *   etransport_file (a transport declaration, a fiscal one), so the
 *   client asks the user to approve each call. The line a user confirms when
 *   the server asks (MCP_CONFIRM=elicit) is the use case's
 *   (app/usecases/uploads.ts), from the XML, over the arguments parsed with
 *   the tool's own schema (the kit's summaryFrom). The file is read first
 *   (`resolve`), so the line and the upload see the same bytes, never just a
 *   file's name.
 */

/**
 * This process's file reader, made on first use: the environment is the
 * service's. The same reader the tools get (composition.ts): the file roots,
 * and the outbox, where build_invoice leaves an invoice for upload_invoice.
 */
let reader: InputFiles | undefined;
const readInput = (source: FileSource) => (reader ??= withOutbox(inputFilesFrom(process.env), resolvePaths(process.env).downloadsDir))(source);

export const POLICY: ToolPolicy = {
  health: { access: "read" },
  token_status: { access: "read" },
  list_invoices: { access: "read" },
  list_invoices_window: { access: "read" },
  download_invoice: { access: "read" },
  upload_status: { access: "read" },
  etransport_list: { access: "read" },
  etransport_status: { access: "read" },
  validate_invoice: { access: "read" },
  parse_invoice: { access: "read" },
  build_invoice: { access: "read" },
  invoice_pdf: { access: "read" },
  verify_signature: { access: "read" },
  lookup_company: { access: "read" },
  refresh_token: { access: "write" },
  begin_authorization: { access: "write" },
  complete_authorization: { access: "write" },
  upload_invoice: {
    access: "money",
    summary: summaryFrom(resolvedUploadArgs, (args) => uploadConfirmationLine(readInvoiceXml, toUploadArgs(args))),
    resolve: (args) => resolveUpload(readInput, readInvoiceXml, args),
  },
  etransport_file: {
    access: "money",
    summary: summaryFrom(resolvedFilingArgs, (args) => filingConfirmationLine(readDeclarationXml, toFilingArgs(args))),
    resolve: (args) => resolveFiling(readInput, readDeclarationXml, args),
  },
  upload_invoice_b2c: {
    access: "money",
    summary: summaryFrom(resolvedUploadArgs, (args) => uploadConfirmationLine(readInvoiceXml, { ...toUploadArgs(args), b2c: true })),
    resolve: (args) => resolveUpload(readInput, readInvoiceXml, args),
  },
};
