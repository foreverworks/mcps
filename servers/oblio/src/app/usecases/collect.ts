import { type DocumentRef } from "../../domain/document.js";
import { fail, inputError } from "../../domain/errors.js";
import { contentKey } from "../../domain/keys.js";
import {
  balanceOf,
  type CollectPlan,
  type CollectRequest,
  collectRequestProblems,
  ensurePayable,
  findPayment,
  payableProblems,
  owedAfter,
  paymentOf,
} from "../../domain/payment.js";
import type { Deps } from "../ports.js";
import { actedOn, label, numbered } from "./documents.js";
import { scope } from "./nomenclature.js";

/**
 * The plan a payment is recorded by, made from the invoice as Oblio holds it.
 * The guard makes it before the confirmation (mcp/policy.ts, `resolve`), so the
 * line a person reads and the call that runs are one plan.
 *
 * Its key is derived from the invoice and the payment, as create_invoice
 * derives one from a document. Oblio documents `idempotencyKey` for issuing
 * and deleting, not for this call, so the key is sent and the server does not
 * rely on it: what keeps a retry from paying twice is the read before, which
 * finds a payment with the same type, reference, amount and date already on
 * the invoice and sends nothing. A caller who means a second, identical
 * payment gives a key of their own, and that check is skipped.
 */
export const planCollect = async (deps: Deps, request: CollectRequest): Promise<CollectPlan> => {
  ensurePayable(collectRequestProblems(request));
  const q = await scope(deps);
  const invoice = await deps.oblio.findInvoice({ ...q, ref: request.ref });
  if (invoice === undefined)
    return fail(inputError(`there is no issued invoice ${label(request.ref)}; list_invoices shows the company's invoices`));
  const ref: DocumentRef = { seriesName: invoice.seriesName, number: invoice.number };
  const payment = paymentOf(request);
  const balance = balanceOf(invoice);
  const alreadyRecorded = request.idempotencyKey === undefined ? findPayment(invoice.collects, payment) : undefined;
  if (alreadyRecorded === undefined) ensurePayable(payableProblems(invoice, balance, request.amount));
  return {
    ref,
    client: invoice.client?.name ?? "a buyer the invoice does not name",
    companyCif: q.cif,
    balance,
    payment,
    outstandingAfter: owedAfter(balance, request.amount),
    idempotencyKey: request.idempotencyKey ?? contentKey("collect", q.cif, { ref, payment }, request.date),
    ...(alreadyRecorded === undefined ? {} : { alreadyRecorded }),
  };
};

/**
 * Record a payment on an issued invoice. It is a `money` tool (it changes a
 * fiscal document's state): the client asks the user to approve each call.
 * Given no plan (a caller outside the guard), it makes its own.
 */
export const collectInvoice = async (deps: Deps, request: CollectRequest, given?: CollectPlan) => {
  const plan = given ?? (await planCollect(deps, request));
  const common = { idempotencyKey: plan.idempotencyKey, companyCif: plan.companyCif };
  if (plan.alreadyRecorded !== undefined)
    return { invoice: plan.ref, alreadyRecorded: plan.alreadyRecorded, balance: plan.balance, sent: false, ...common };
  const view = await numbered(deps, plan.idempotencyKey, () =>
    deps.oblio.collectInvoice({ cif: plan.companyCif, ref: plan.ref, payment: plan.payment, idempotencyKey: plan.idempotencyKey }),
  );
  const acted = actedOn(plan.ref, view, "recorded a payment on");
  const recorded = findPayment(acted.collects, plan.payment);
  return {
    invoice: { seriesName: acted.seriesName, number: acted.number, ...(acted.link === undefined ? {} : { link: acted.link }) },
    ...(recorded === undefined
      ? { recordCheck: "Oblio's answer does not list this payment; get_invoice shows the payments the invoice carries" }
      : { recorded }),
    balance: { ...plan.balance, outstandingAfter: plan.outstandingAfter },
    sent: true,
    ...common,
  };
};
