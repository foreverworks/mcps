import type { OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { invoicePdf, validateInvoice } from "../../app/usecases/documents.js";
import { parseInvoice } from "../../app/usecases/parse.js";
import { verifySignature } from "../../app/usecases/signatures.js";
import { handled } from "../envelope.js";
import { documentInput, type FileArg, fileArg, xmlTextArg } from "../fileArgs.js";
import { PARSE_OUTPUT } from "../outputs.js";
import type { Registrar } from "./types.js";

const messageId = z.string().default("").describe("The id field from list_invoices (digits), not requestId.");

/**
 * What a server with no grant offers of these tools: nothing that fetches a
 * filed invoice (message_id, test, an archive in the downloads outbox), and no
 * folder to save into when there is no outbox, since the file is attached to
 * the answer. The descriptions say the same, so no tool offers what it would
 * refuse.
 */
export const registerDocuments: Registrar = (server, deps) => {
  const { grantless, outbox } = deps.mode;
  // Where a path may point and how else a file may come, in the reader's own words (mcp-kit, from MCP_FILE_ROOTS).
  const files = deps.files.readInput;
  // With no grant there is no disk to read from, so a document goes in as its XML text (fileArgs.ts); otherwise by path or checked base64.
  const document = (what: string) => (grantless ? xmlTextArg(what) : fileArg(what, files));
  const given = grantless ? "the XML text as xml, which the server hashes (answered in file: size, sha256)" : "xml: { path } for a file, or { content_base64, sha256 } from a script";
  server.registerTool(
    "validate_invoice",
    {
      title: "Validate an invoice with ANAF",
      description:
        "Check a UBL invoice or credit note against ANAF's own schema and CIUS-RO rules without " +
        "filing it. Answers valid, and when not, findings: each with the rule it broke (e.g. BR-RO-001), where " +
        "in the document, and ANAF's text. invoice is what the XML says it is, and file which file was read (name, " +
        "size, sha256). Needs no grant. CII is not accepted: ANAF validates UBL only. The document goes as " +
        `${given}.`,
      inputSchema: { xml: document("The invoice XML (at most 5 MB)") },
    },
    handled((args: { xml: FileArg | string }) => validateInvoice(deps, { xml: documentInput("xml", args.xml) })),
  );

  server.registerTool(
    "parse_invoice",
    {
      title: "Read an invoice as JSON",
      description:
        "Read a UBL invoice or credit note into plain JSON: seller and buyer (names, VAT and legal ids, " +
        "address, contact), every line (quantity, unit, price, net amount, VAT category and rate), the VAT " +
        "breakdown, the totals, and the payment terms (due date, terms, IBAN). Every value is the document's own " +
        "text, amounts included, never a number; a field the document does not fill is absent. Give " +
        (grantless ? given : `xml ({ path } for a file, or { content_base64, sha256 } from a script)`) + (grantless ? "" : " or archive, a .zip download_invoice saved to the outbox") + ". " +
        "Reads only: nothing goes to ANAF. To have ANAF check the document, use validate_invoice.",
      inputSchema: grantless
        ? { xml: document("A UBL invoice or credit note").optional() }
        : {
            xml: document("A UBL invoice or credit note").optional(),
            archive: z.string().default("").describe("A .zip in the downloads outbox, from download_invoice: its name, or its path under the outbox."),
          },
      outputSchema: PARSE_OUTPUT,
    },
    handled((args: { xml?: FileArg | string; archive?: string }): Promise<OutputOf<typeof PARSE_OUTPUT>> =>
      parseInvoice(deps, { xml: documentInput("xml", args.xml), archive: args.archive ?? "" }),
    ),
  );

  const saveDir = z
    .string()
    .default("")
    .describe("A folder INSIDE the downloads outbox (e.g. \"2026-09\"); empty means the outbox itself. A path outside it is refused.");
  const pdfDocument = document("A UBL invoice or credit note").optional();
  const validate = z.boolean().default(true).describe("For a document only: validate before converting.");
  const pdfInput = grantless
    ? { xml: pdfDocument, validate, ...(outbox ? { save_dir: saveDir } : {}) }
    : {
        message_id: messageId,
        xml: pdfDocument,
        validate,
        save_dir: saveDir,
        test: z.boolean().default(false).describe("For message_id only: fetch it from ANAF's test environment."),
      };
  server.registerTool(
    "invoice_pdf",
    {
      title: "Render an invoice as ANAF's PDF",
      description:
        "Have ANAF render an invoice as its official PDF" +
        (outbox ? " and save it to the downloads outbox" : ", attached to the answer as a file (this server keeps no copy)") +
        ". Give " +
        (grantless ? "the UBL document" : "message_id (from list_invoices) for a filed invoice, or a UBL document") +
        (grantless ? " as " + given + ". " : " as xml ({ path } for a file, or { content_base64, sha256 } from a script). ") +
        (grantless ? "The document" : "A filed invoice is not validated again; a document") +
        " is validated first " +
        "unless validate is false, and when it fails nothing is " +
        (outbox ? "saved" : "returned") +
        " and findings say why. Returns " +
        (outbox ? "saved, path, bytes and sha256 of the PDF" : "saved, name, bytes, sha256 and md5 of the PDF, and the PDF itself attached") +
        ". The PDF itself needs no grant" +
        (grantless ? "." : "; fetching a filed invoice by message_id does."),
      inputSchema: pdfInput,
    },
    handled((args: { message_id?: string; xml?: FileArg | string; validate: boolean; save_dir?: string; test?: boolean }) =>
      invoicePdf(deps, {
        messageId: args.message_id ?? "",
        xml: documentInput("xml", args.xml),
        validate: args.validate,
        saveDir: args.save_dir ?? "",
        test: args.test ?? false,
      }),
    ),
  );

  const sealInput = grantless
    ? {
        xml: document("The invoice XML from the archive"),
        signature: document("The semnatura_*.xml from the same archive"),
      }
    : {
        message_id: messageId,
        archive: z.string().default("").describe("A .zip in the downloads outbox: its name, or its path under the outbox."),
        xml: fileArg("The invoice XML from the archive", files).optional(),
        signature: fileArg("The semnatura_*.xml from the same archive", files).optional(),
        test: z.boolean().default(false).describe("For message_id only: fetch it from ANAF's test environment."),
      };
  server.registerTool(
    "verify_signature",
    {
      title: "Verify ANAF's seal on an invoice",
      description:
        "Check that an invoice is the file ANAF stored, under ANAF's seal (semnatura_*.xml). Give " +
        (grantless
          ? "the two files from an archive kept elsewhere (costs nothing): xml and signature, each "
          : "ONE of: message_id (downloads the archive: ANAF allows 10 downloads a day per message), archive (a .zip " +
            "already in the downloads outbox, from download_invoice; costs nothing), or the two files from an " +
            "archive kept elsewhere (costs nothing): xml and signature, each ") +
        (grantless ? "the XML text of each, " : "{ path } or { content_base64, sha256 }, ") +
        "read byte for byte, since the seal covers the invoice's exact bytes" +
        (grantless ? " (text you retype may differ from the file; the sha256 of what arrived is in source, to compare with the file's)" : "") +
        ". " +
        "Checked locally first: the " +
        "certificate against Trans Sped's seal CA and the Ministry of Finance, the signature, and the digest of " +
        "the invoice's raw bytes. Only when that cannot decide is ANAF asked. Answers valid, checkedBy (local " +
        "or anaf), a reason when not valid, and the certificate. Revocation is not checked locally.",
      inputSchema: sealInput,
    },
    handled(
      (args: { message_id?: string; archive?: string; xml?: FileArg | string; signature?: FileArg | string; test?: boolean }) =>
        verifySignature(deps, {
          messageId: args.message_id ?? "",
          archive: args.archive ?? "",
          xml: documentInput("xml", args.xml),
          signature: documentInput("signature", args.signature),
          test: args.test ?? false,
        }),
    ),
  );
};
