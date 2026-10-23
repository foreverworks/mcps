import type { z } from "zod";

import {
  cancelInvoice,
  createInvoice,
  createProforma,
  deleteInvoice,
  getInvoice,
  getProforma,
  invoiceFromProforma,
  restoreInvoice,
} from "../../app/usecases/documents.js";
import {
  ACT_INPUT,
  type actArgs,
  FROM_PROFORMA_INPUT,
  type fromProformaArgs,
  INVOICE_INPUT,
  type InvoiceArgs,
  PROFORMA_INPUT,
  type ProformaArgs,
  REF_INPUT,
  type refArgs,
  toFromProformaDraft,
  toInvoiceDraft,
  toProformaDraft,
  toRef,
  toTarget,
} from "../documentArgs.js";
import { collectInvoice } from "../../app/usecases/collect.js";
import { listInvoices } from "../../app/usecases/listing.js";
import { reverseInvoice } from "../../app/usecases/reverse.js";
import { type CollectArgs, COLLECT_INPUT, collectPlanIn, toCollectRequest } from "../collectArgs.js";
import { handled } from "../envelope.js";
import { LIST_INPUT, type ListArgs, toListInvoicesArgs } from "../listArgs.js";
import { REVERSE_INPUT, type ReverseArgs, reversalPlanIn, toReversalRequest } from "../reverseArgs.js";
import type { Registrar } from "./types.js";

type RefArgs = z.infer<typeof refArgs>;
type ActArgs = z.infer<typeof actArgs>;

const ACT_NOTES =
  "The invoice is read first: the answer says what it totalled (before), and with expect_total a call whose " +
  "number names an invoice of another total changes nothing.";

const ISSUE_NOTES =
  "Prices, quantities and rates are decimal STRINGS. Every line states vat_included. The buyer's CIF or CNP and " +
  "IBAN are checked by their control digits. The company is the one in app.json; the input has no field for it. " +
  "The answer carries computedTotal (exact, EN 16931 rounding), oblioTotal (the document read back, which must " +
  "match) and the idempotency_key it was sent with.";

export const registerDocuments: Registrar = (server, deps) => {
  server.registerTool(
    "get_invoice",
    { title: "Get an invoice", description: "One invoice by series and number: its PDF and e-Factura links, and the payments recorded against it.", inputSchema: REF_INPUT },
    handled((args: RefArgs) => getInvoice(deps, toRef(args))),
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List issued invoices",
      description:
        "The company's issued invoices, newest first, filtered by issue date, series, buyer (CIF, e-mail or code; " +
        'list_clients finds them by name), status ("unpaid", "paid", "cancelled") and e-Factura state. Each row: ' +
        "series and number, dates, currency, total with VAT as Oblio wrote it, whether it is cancelled, the buyer, " +
        "the payments recorded against it, its e-Factura state and its PDF link. Drafts are never listed. Pass " +
        "nextCursor back, with the same filters, for the next page; get_invoice reads one invoice.",
      inputSchema: LIST_INPUT,
    },
    handled((args: ListArgs) => listInvoices(deps, toListInvoicesArgs(args))),
  );

  server.registerTool(
    "get_proforma",
    { title: "Get a proforma", description: "One proforma by series and number.", inputSchema: REF_INPUT },
    handled((args: RefArgs) => getProforma(deps, toRef(args))),
  );

  server.registerTool(
    "create_invoice",
    {
      title: "Issue an invoice",
      description:
        "Issue a new invoice. A real fiscal document: it takes the next number in the series, and in Romania it is " +
        `what gets reported to ANAF. ${ISSUE_NOTES}`,
      inputSchema: INVOICE_INPUT,
    },
    handled((args: InvoiceArgs) => createInvoice(deps, toInvoiceDraft(args))),
  );

  server.registerTool(
    "create_proforma",
    {
      title: "Issue a proforma",
      description: `Issue a new proforma, which is not a fiscal document but takes a number in its series. ${ISSUE_NOTES}`,
      inputSchema: PROFORMA_INPUT,
    },
    handled((args: ProformaArgs) => createProforma(deps, toProformaDraft(args))),
  );

  server.registerTool(
    "invoice_from_proforma",
    {
      title: "Invoice an existing proforma",
      description:
        "Issue an invoice that references an existing proforma, so the two are linked in Oblio. Client, lines and " +
        "total are the proforma's; nothing is retyped. The proforma is read first and returned as fromProforma, and " +
        "the new invoice's total is held to it.",
      inputSchema: FROM_PROFORMA_INPUT,
    },
    handled((args: z.infer<typeof fromProformaArgs>) => invoiceFromProforma(deps, toFromProformaDraft(args))),
  );

  server.registerTool(
    "collect_invoice",
    {
      title: "Record a payment on an invoice",
      description:
        "Record a payment received against an issued invoice: how it was paid, the amount in the invoice's currency " +
        "(a decimal STRING), the day, and the payment's own reference. The invoice is read first: a cancelled one, one " +
        "paid in full, or an amount over what it still owes is refused with nothing recorded, and a payment already on " +
        "it with the same type, reference, amount and date is not recorded again (the answer says alreadyRecorded). " +
        "The answer carries the balance before and after. list_invoices with status unpaid finds what is owed.",
      inputSchema: COLLECT_INPUT,
    },
    handled((args: CollectArgs) => collectInvoice(deps, toCollectRequest(args), collectPlanIn(args))),
  );

  server.registerTool(
    "cancel_invoice",
    {
      title: "Cancel an invoice",
      description:
        "Mark an invoice cancelled. Reversible with restore_invoice, and the number stays in the series, which is " +
        `what a tax authority expects of an issued document. Prefer this over delete_invoice. ${ACT_NOTES}`,
      inputSchema: ACT_INPUT,
    },
    handled((args: ActArgs) => cancelInvoice(deps, toTarget(args))),
  );

  server.registerTool(
    "restore_invoice",
    { title: "Restore a cancelled invoice", description: `Undo cancel_invoice. ${ACT_NOTES}`, inputSchema: ACT_INPUT },
    handled((args: ActArgs) => restoreInvoice(deps, toTarget(args))),
  );

  server.registerTool(
    "reverse_invoice",
    {
      title: "Reverse an invoice (storno)",
      description:
        "Issue a reversing invoice (storno) for an issued invoice, through Oblio's reference flow: a new invoice that " +
        "references it, every line negated, its total exactly the reversed invoice's total negated. A real fiscal " +
        "document, reported to ANAF like any invoice; the reversed invoice stays issued. Use it for an invoice already " +
        "sent to the client or to ANAF; cancel_invoice is for one nobody has received. The invoice is read first: a " +
        "cancelled one, or one that is itself a reversal, is refused. The answer carries computedTotal and oblioTotal " +
        "(the storno read back, which must match) and the idempotency_key it was sent with.",
      inputSchema: REVERSE_INPUT,
    },
    handled((args: ReverseArgs) => reverseInvoice(deps, toReversalRequest(args), reversalPlanIn(args))),
  );

  server.registerTool(
    "delete_invoice",
    {
      title: "Delete an invoice permanently",
      description:
        "Remove an invoice from Oblio for good. NO INVERSE. Oblio allows it only for the last number in a series, " +
        "and anything already sent to ANAF stays there, so the two can end up out of step. cancel_invoice is " +
        `almost always the right call instead. ${ACT_NOTES}`,
      inputSchema: ACT_INPUT,
    },
    handled((args: ActArgs) => deleteInvoice(deps, toTarget(args))),
  );
};
