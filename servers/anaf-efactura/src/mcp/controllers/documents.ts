import type { OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { invoicePdf, validateInvoice } from "../../app/usecases/documents.js";
import { parseInvoice } from "../../app/usecases/parse.js";
import { verifySignature } from "../../app/usecases/signatures.js";
import { handled } from "../envelope.js";
import { documentInput, type FileArg, fileArg } from "../fileArgs.js";
import { PARSE_OUTPUT } from "../outputs.js";
import type { Registrar } from "./types.js";

const messageId = z.string().default("").describe("The id field from list_invoices (digits), not requestId.");

export const registerDocuments: Registrar = (server, deps) => {
  // Where a path may point and how else a file may come, in the reader's own words (mcp-kit, from MCP_FILE_ROOTS).
  const files = deps.files.readInput;
  server.registerTool(
    "validate_invoice",
    {
      title: "Validate an invoice with ANAF",
      description:
        "Check a UBL invoice or credit note against ANAF's own schema and CIUS-RO rules without " +
        "filing it. Answers valid, and when not, findings: each with the rule it broke (e.g. BR-RO-001), where " +
        "in the document, and ANAF's text. invoice is what the XML says it is, and file which file was read (name, " +
        "size, sha256). Needs no grant. CII is not accepted: ANAF validates UBL only. The document goes as xml: " +
        "{ path } for a file, or { content_base64, sha256 } from a script.",
      inputSchema: { xml: fileArg("The invoice XML (at most 5 MB)", files) },
    },
    handled((args: { xml: FileArg }) => validateInvoice(deps, { xml: documentInput("xml", args.xml) })),
  );

  server.registerTool(
    "parse_invoice",
    {
      title: "Read an invoice as JSON",
      description:
        "Read a UBL invoice or credit note into plain JSON: seller and buyer (names, VAT and legal ids, " +
        "address, contact), every line (quantity, unit, price, net amount, VAT category and rate), the VAT " +
        "breakdown, the totals, and the payment terms (due date, terms, IBAN). Every value is the document's own " +
        "text, amounts included, never a number; a field the document does not fill is absent. Give xml ({ path } " +
        "for a file, or { content_base64, sha256 } from a script) or archive, a .zip download_invoice saved to " +
        "the outbox. Reads only: nothing goes to ANAF. To have ANAF check the document, use validate_invoice.",
      inputSchema: {
        xml: fileArg("A UBL invoice or credit note", files).optional(),
        archive: z.string().default("").describe("A .zip in the downloads outbox, from download_invoice: its name, or its path under the outbox."),
      },
      outputSchema: PARSE_OUTPUT,
    },
    handled((args: { xml?: FileArg; archive: string }): Promise<OutputOf<typeof PARSE_OUTPUT>> =>
      parseInvoice(deps, { xml: documentInput("xml", args.xml), archive: args.archive }),
    ),
  );

  server.registerTool(
    "invoice_pdf",
    {
      title: "Render an invoice as ANAF's PDF",
      description:
        "Have ANAF render an invoice as its official PDF and save it to the downloads outbox. Give message_id " +
        "(from list_invoices) for a filed invoice, or a UBL document as xml ({ path } for a file, or " +
        "{ content_base64, sha256 } from a script). A filed invoice is not validated again; a document is validated first " +
        "unless validate is false, and when it fails nothing is saved and findings say why. Returns saved, path, " +
        "bytes and sha256 of the PDF. The PDF itself needs no grant; fetching a filed invoice by message_id does.",
      inputSchema: {
        message_id: messageId,
        xml: fileArg("A UBL invoice or credit note", files).optional(),
        validate: z.boolean().default(true).describe("For a document only: validate before converting."),
        save_dir: z
          .string()
          .default("")
          .describe("A folder INSIDE the downloads outbox (e.g. \"2026-09\"); empty means the outbox itself. A path outside it is refused."),
        test: z.boolean().default(false).describe("For message_id only: fetch it from ANAF's test environment."),
      },
    },
    handled((args: { message_id: string; xml?: FileArg; validate: boolean; save_dir: string; test: boolean }) =>
      invoicePdf(deps, {
        messageId: args.message_id,
        xml: documentInput("xml", args.xml),
        validate: args.validate,
        saveDir: args.save_dir,
        test: args.test,
      }),
    ),
  );

  server.registerTool(
    "verify_signature",
    {
      title: "Verify ANAF's seal on an invoice",
      description:
        "Check that an invoice is the file ANAF stored, under ANAF's seal (semnatura_*.xml). Give ONE of: " +
        "message_id (downloads the archive: ANAF allows 10 downloads a day per message), archive (a .zip " +
        "already in the downloads outbox, from download_invoice; costs nothing), or the two files from an " +
        "archive kept elsewhere (costs nothing): xml and signature, each { path } or { content_base64, sha256 }, " +
        "read byte for byte, since the seal covers the invoice's exact bytes. " +
        "Checked locally first: the " +
        "certificate against Trans Sped's seal CA and the Ministry of Finance, the signature, and the digest of " +
        "the invoice's raw bytes. Only when that cannot decide is ANAF asked. Answers valid, checkedBy (local " +
        "or anaf), a reason when not valid, and the certificate. Revocation is not checked locally.",
      inputSchema: {
        message_id: messageId,
        archive: z.string().default("").describe("A .zip in the downloads outbox: its name, or its path under the outbox."),
        xml: fileArg("The invoice XML from the archive", files).optional(),
        signature: fileArg("The semnatura_*.xml from the same archive", files).optional(),
        test: z.boolean().default(false).describe("For message_id only: fetch it from ANAF's test environment."),
      },
    },
    handled(
      (args: { message_id: string; archive: string; xml?: FileArg; signature?: FileArg; test: boolean }) =>
        verifySignature(deps, {
          messageId: args.message_id,
          archive: args.archive,
          xml: documentInput("xml", args.xml),
          signature: documentInput("signature", args.signature),
          test: args.test,
        }),
    ),
  );
};
