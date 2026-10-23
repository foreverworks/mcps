import { z } from "zod";

import { saveInvoicePdf } from "../../app/invoicePdf.js";
import { OUTBOX_VARIABLE } from "../../domain/errors.js";
import { expectVendorTakes, vendorArg, type Wrapper } from "./offered.js";

/**
 * get_invoice_pdf as this server offers it: the PDF saved to the outbox
 * (app/invoicePdf.ts) with its SHA-256, instead of its base64 in the answer.
 */

const where = (outbox: string | undefined): string =>
  outbox === undefined
    ? `This server has no outbox yet (${OUTBOX_VARIABLE}), so the call fails until one is set; \`get_invoice\` still gives the \`downloadUrl\`.`
    : `The file goes in ${outbox}, or a folder inside it named by save_dir.`;

export const invoicePdfTool: Wrapper = (deps, vendor) => {
  expectVendorTakes(vendor, { invoice_id: 1 }, "src/mcp/register/invoicePdf.ts");
  return {
    description:
      "Save an invoice PDF, the same document as Download PDF on porkbun.com, in this server's outbox. The bytes are checked to be a PDF " +
      "of the size Porkbun states before anything is written. The answer gives the file's path, size and sha256, with Porkbun's own " +
      "fields: `filename`, `sizeBytes`, and `downloadUrl`, a link that downloads it without signing in until `downloadExpires` (15 minutes). " +
      "Invoice IDs come from `list_invoices`; an ID not on this account returns `INVOICE_NOT_FOUND`. " +
      where(deps.outbox),
    inputSchema: {
      invoice_id: vendorArg(vendor, "invoice_id", z.number().int().positive()),
      save_dir: z.string().optional().describe("A folder inside the outbox to save into (created if missing). Default: the outbox itself."),
    },
    run: (args) => {
      const saveDir = args["save_dir"];
      return saveInvoicePdf(deps, { invoiceId: Number(args["invoice_id"]), ...(typeof saveDir === "string" ? { saveDir } : {}) });
    },
  };
};
