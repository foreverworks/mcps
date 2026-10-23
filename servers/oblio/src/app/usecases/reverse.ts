import { fail, inputError } from "../../domain/errors.js";
import { contentKey } from "../../domain/keys.js";
import { ensureReversible, type ReversalPlan, reversalOf, type ReversalRequest, reversalProblems } from "../../domain/reversal.js";
import type { Deps } from "../ports.js";
import { label, numbered, readBack } from "./documents.js";
import { scope } from "./nomenclature.js";

/**
 * The plan a storno is issued by, made from the invoice as Oblio holds it, so
 * the line a person confirms (mcp/policy.ts, `resolve`) names its real buyer,
 * currency and total, and the call issues exactly that.
 *
 * Its key is derived from what the reversal IS: the company, the invoice it
 * reverses, the series it goes into and what happens to the payments, keyed
 * to the reversed invoice's own issue date. One invoice is reversed once, so
 * no retry, on any day, can issue a second storno of it; reversing it again
 * on purpose (after cancelling the first storno) needs a key of the caller's
 * own.
 */
export const planReversal = async (deps: Deps, request: ReversalRequest): Promise<ReversalPlan> => {
  const q = await scope(deps);
  const invoice = await deps.oblio.findInvoice({ ...q, ref: request.ref });
  if (invoice === undefined)
    return fail(inputError(`there is no issued invoice ${label(request.ref)}; list_invoices shows the company's invoices`));
  ensureReversible(reversalProblems(invoice, request.expectTotal));
  const ref = { seriesName: invoice.seriesName, number: invoice.number };
  const key =
    request.idempotencyKey ??
    contentKey(
      "reversal",
      q.cif,
      { ref, seriesName: request.seriesName ?? invoice.seriesName, removePayments: request.removePayments },
      invoice.issueDate,
    );
  return reversalOf(invoice, request, q.cif, key);
};

/**
 * Issue the reversing invoice. A `money` tool (a fiscal document is made):
 * the client asks the user to approve each call. Afterwards the storno is read
 * back and its total held to the plan's, the negated total of the invoice it
 * reverses. Given no plan (a caller outside the guard), it makes its own.
 */
export const reverseInvoice = async (deps: Deps, request: ReversalRequest, given?: ReversalPlan) => {
  const plan = given ?? (await planReversal(deps, request));
  const q = { cif: plan.companyCif };
  const issued = await numbered(deps, plan.idempotencyKey, () => deps.oblio.issueReversal({ ...q, plan }));
  const check = await readBack((ref) => deps.oblio.getInvoice({ ...q, ref }), "invoice", issued, {
    total: plan.reversalTotal,
    currency: plan.currency,
  });
  return {
    ...issued,
    reverses: { ...plan.ref, total: plan.total, client: plan.client },
    computedTotal: { gross: plan.reversalTotal, currency: plan.currency },
    ...check,
    paymentsRemoved: plan.removePayments && plan.payments > 0,
    idempotencyKey: plan.idempotencyKey,
    companyCif: plan.companyCif,
  };
};
