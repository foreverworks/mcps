import { decodeBase64Strict, resolveSaveDir, saveToOutbox, unsetPath } from "@foreverworks/mcp-kit";

import { fail, inputError, OUTBOX_VARIABLE } from "../domain/errors.js";
import { annotated } from "./callTool.js";
import type { Deps } from "./ports.js";

/**
 * get_invoice_pdf, with the file saved instead of carried in the answer. The
 * vendor's tool returns the PDF as base64 in its result (`contentBase64`,
 * which its own server turns into an embedded resource), about 20,000
 * characters a model would otherwise hold or try to copy. Here the bytes are
 * decoded strictly, checked to be a PDF of the size Porkbun states, and
 * written to the outbox; the answer is Porkbun's own fields with the file's
 * path, size and SHA-256 in place of the content.
 */

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {};

const drift = (message: string): never => fail({ kind: "drift", message: `get_invoice_pdf: ${message}; nothing was saved` });

/** The name Porkbun gives the file when it is a plain one, else one made from the invoice id. */
const fileName = (given: unknown, invoiceId: number): string =>
  typeof given === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.pdf$/i.test(given) ? given : `porkbun-invoice-${String(invoiceId)}.pdf`;

const PDF_MAGIC = Buffer.from("%PDF-", "latin1");

export const saveInvoicePdf = async (deps: Deps, args: { readonly invoiceId: number; readonly saveDir?: string }) => {
  const outbox = deps.outbox ?? fail({ kind: "config", variable: OUTBOX_VARIABLE, message: unsetPath(OUTBOX_VARIABLE) });
  const where = resolveSaveDir(outbox, args.saveDir);
  if (!where.ok) return fail(inputError(where.reason));

  const answer = record(await deps.porkbun.run("get_invoice_pdf", { invoice_id: args.invoiceId }));
  const { contentBase64, ...meta } = answer;
  if (typeof contentBase64 !== "string" || contentBase64.trim() === "") return drift("Porkbun's answer has no contentBase64");
  const bytes = decodeBase64Strict(contentBase64) ?? drift("contentBase64 is not standard base64");
  if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return drift("the file Porkbun sent does not start like a PDF (%PDF-)");
  const stated = meta["sizeBytes"];
  if (typeof stated === "number" && stated !== bytes.length) return drift(`Porkbun says the file is ${String(stated)} bytes and sent ${String(bytes.length)}`);

  const { path, size, sha256 } = await saveToOutbox(where.dir, fileName(meta["filename"], args.invoiceId), bytes);
  return annotated(meta, { file: { path, size, sha256, contentType: "application/pdf" } });
};
