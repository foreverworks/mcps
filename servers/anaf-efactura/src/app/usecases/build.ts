import { resolveSaveDir, sha256Of } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../../domain/errors.js";
import { buildInvoiceXml, draftProblems, type InvoiceDraft, normalDraft } from "../../domain/invoiceBuild.js";
import type { Deps } from "../ports.js";

export type BuildInvoiceArgs = {
  readonly draft: InvoiceDraft;
  /** The file's name in the outbox; empty means the invoice number's. */
  readonly fileName: string;
  /** A folder inside the outbox; empty means the outbox itself. */
  readonly saveDir: string;
};

/** A name the outbox can hold: the characters a file name may safely carry, `.xml` at the end. */
export const builtFileName = (wanted: string): string => {
  const stem = wanted.replace(/\.xml$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 100);
  return `${stem === "" ? "invoice" : stem}.xml`;
};

/**
 * A CIUS-RO invoice built from fields and saved to the outbox, ready for
 * validate_invoice and upload_invoice by the path this answers. Nothing is
 * sent anywhere: building files nothing.
 *
 * The draft is checked first, every problem named at once; then written by
 * domain/invoiceBuild.ts, whose totals are the kit's EN 16931 rule. `invoice`
 * is the file read back by the same reading upload_invoice confirms, so what
 * this says the file is and what an upload will say cannot differ. A file of
 * the same name holding other bytes is never replaced: the new one is numbered.
 * A buyer outside Romania is answered `extern: true`, the flag upload_invoice
 * needs for it: without it ANAF looks for a Romanian CUI and refuses the file
 * (ERRIdentif, which validate_invoice reports too, having no such flag).
 */
export const buildInvoice = async (deps: Deps, args: BuildInvoiceArgs) => {
  const where = resolveSaveDir(deps.paths.downloadsDir, args.saveDir);
  if (!where.ok) return fail(inputError(where.reason));
  const draft = normalDraft(args.draft);
  const problems = draftProblems(draft);
  if (problems.length > 0) return fail(inputError(`the invoice was not built: ${problems.join("; ")}`));
  const { xml, totals } = buildInvoiceXml(draft);
  const bytes = Buffer.from(xml, "utf8");
  const reading = deps.readInvoice(xml);
  const path = await deps.files.writeFile(where.dir, builtFileName(args.fileName === "" ? draft.number : args.fileName), bytes);
  return {
    path,
    bytes: bytes.length,
    sha256: sha256Of(bytes),
    invoice: reading.kind === "invoice" ? reading.facts : fail(inputError(`the built invoice does not read back: ${reading.why}`)),
    // ANAF's /upload identifies a buyer by a Romanian CUI unless told the buyer is foreign.
    ...(draft.buyer.address.country === "RO" ? {} : { extern: true as const }),
    totals: {
      lines: totals.net,
      vat: totals.vat,
      payable: totals.gross,
      currency: totals.currency,
      ...(totals.vatInRon === undefined ? {} : { vatInRon: totals.vatInRon }),
      breakdown: totals.byRate.map((r) => ({ category: r.vatCategory ?? "S", percent: r.vatPercentage, taxable: r.net, tax: r.vat })),
    },
  };
};
