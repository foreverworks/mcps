import { compare, documentTotal, parseDecimal } from "@foreverworks/mcp-kit";

import { type DocumentRef, type FromProformaDraft, type InvoiceDraft, type ProformaDraft, sameDocument } from "../../domain/document.js";
import { apiError, asAppError, DRIFT, fail, inputError, OUTCOME_UNKNOWN, TOTAL_MISMATCH } from "../../domain/errors.js";
import { contentKey, type KeyedKind } from "../../domain/keys.js";
import type { DocumentView, Issued } from "../../domain/models.js";
import { documentProblems, ensureValid, invoiceProblems } from "../../domain/rules.js";
import type { Deps } from "../ports.js";
import { scope } from "./nomenclature.js";

export const getInvoice = async (deps: Deps, ref: DocumentRef) => deps.oblio.getInvoice({ ...(await scope(deps)), ref });

export const getProforma = async (deps: Deps, ref: DocumentRef) =>
  deps.oblio.getProforma({ ...(await scope(deps)), ref });

export const label = (r: DocumentRef): string => `${r.seriesName} ${r.number}`;

/** Two decimal strings, equal in value ("121.0" is "121.00"); false when either is not one. */
const sameAmount = (a: string, b: string): boolean => {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  return x !== undefined && y !== undefined && compare(x, y) === 0;
};

/**
 * Run a write that takes a number out of a series.
 *
 * The cached series are forgotten whatever the outcome, because `next` has
 * moved on success and may have moved on a lost answer. A lost answer is
 * re-raised naming the idempotency key it was sent with: Oblio refuses a
 * second document with the same key, so calling again WITH it is the one retry
 * that cannot issue twice.
 */
export const numbered = async <T>(deps: Deps, key: string | undefined, write: () => Promise<T>): Promise<T> => {
  try {
    return await write();
  } catch (thrown) {
    const error = asAppError(thrown);
    if (error?.kind === "api" && error.reason === OUTCOME_UNKNOWN && key !== undefined)
      fail({ ...error, message: `${error.message}. It was sent with idempotency_key "${key}"` });
    throw thrown;
  } finally {
    deps.cache.forgetSeries();
  }
};

/** The day a document is issued on: its own date, else today (UTC), which is what Oblio's default means within a few hours. */
const dayOf = (deps: Deps, issueDate: string | undefined): string => issueDate ?? new Date(deps.now()).toISOString().slice(0, 10);

/** The draft with its key: the caller's, else one derived from its content (domain/keys.ts). */
const keyed = <D extends { readonly idempotencyKey?: string }>(
  deps: Deps,
  kind: KeyedKind,
  cif: string,
  draft: D,
  issueDate: string | undefined,
): D & { readonly idempotencyKey: string } => {
  const { idempotencyKey, ...content } = draft;
  return { ...draft, idempotencyKey: idempotencyKey ?? contentKey(kind, cif, content, dayOf(deps, issueDate)) };
};

/**
 * The document as Oblio now holds it, read back after issuing, and its total
 * held to the one expected. A total that differs fails loudly, naming the
 * document that WAS issued; a read-back that itself fails does not undo the
 * issue, and the answer says the total was not checked.
 */
export const readBack = async (
  read: (ref: DocumentRef) => Promise<DocumentView>,
  what: string,
  issued: Issued,
  expected: { readonly total: string; readonly currency?: string },
) => {
  const view = await read(issued).catch((thrown: unknown) => {
    const error = asAppError(thrown);
    if (error === undefined) throw thrown;
    return error;
  });
  if ("kind" in view) return { totalCheck: `not read back (${view.message}); get_${what === "proforma" ? "proforma" : "invoice"} shows it` };
  if (view.total === undefined) return { totalCheck: "Oblio's answer carried no total" };
  if (!sameAmount(view.total, expected.total))
    return fail(
      apiError(
        200,
        `${what} ${label(issued)} WAS ISSUED, but Oblio's total ${view.total} is not the expected ${expected.total}` +
          `${expected.currency === undefined ? "" : ` ${expected.currency}`}`,
        { reason: TOTAL_MISMATCH },
      ),
    );
  return { oblioTotal: view.total };
};

/** Where Oblio emails the document, when asked to. */
const emailed = (draft: { readonly sendEmail?: boolean; readonly client: { readonly email?: string } }) =>
  draft.sendEmail === true ? { emailedTo: draft.client.email ?? "the email Oblio has saved for this client" } : {};

/**
 * Issue an invoice. The rules run first, so a document that would be refused
 * or silently rounded never reaches Oblio. The company CIF comes from app.json;
 * the input has no field for it, so no pasted example can issue against
 * another company. Afterwards the invoice is read back, and its total held to
 * the one computed here.
 */
export const createInvoice = async (deps: Deps, draft: InvoiceDraft) => {
  ensureValid(invoiceProblems(draft));
  const q = await scope(deps);
  const sent = keyed(deps, "invoice", q.cif, draft, draft.issueDate);
  const issued = await numbered(deps, sent.idempotencyKey, () => deps.oblio.issueInvoice({ ...q, draft: sent }));
  const computedTotal = documentTotal(draft.products, draft.currency);
  const check = await readBack((ref) => deps.oblio.getInvoice({ ...q, ref }), "invoice", issued, {
    total: computedTotal.gross,
    currency: computedTotal.currency,
  });
  return { ...issued, computedTotal, ...check, idempotencyKey: sent.idempotencyKey, companyCif: q.cif, ...emailed(draft) };
};

/** A proforma is not a fiscal document, but it still takes a number from its series. */
export const createProforma = async (deps: Deps, draft: ProformaDraft) => {
  ensureValid(documentProblems(draft));
  const q = await scope(deps);
  const sent = keyed(deps, "proforma", q.cif, draft, draft.issueDate);
  const issued = await numbered(deps, sent.idempotencyKey, () => deps.oblio.issueProforma({ ...q, draft: sent }));
  const computedTotal = documentTotal(draft.products, draft.currency);
  const check = await readBack((ref) => deps.oblio.getProforma({ ...q, ref }), "proforma", issued, {
    total: computedTotal.gross,
    currency: computedTotal.currency,
  });
  return { ...issued, computedTotal, ...check, idempotencyKey: sent.idempotencyKey, companyCif: q.cif, ...emailed(draft) };
};

/**
 * The lines, client and total are the proforma's; nothing is retyped. The
 * proforma is read first, so the answer says what was invoiced, and the new
 * invoice's total is held to it.
 */
export const invoiceFromProforma = async (deps: Deps, draft: FromProformaDraft) => {
  const q = await scope(deps);
  const proforma = await deps.oblio.getProforma({ ...q, ref: draft.proforma });
  const sent = keyed(deps, "invoice-from-proforma", q.cif, draft, undefined);
  const issued = await numbered(deps, sent.idempotencyKey, () => deps.oblio.issueInvoiceFromProforma({ ...q, draft: sent }));
  const check =
    proforma.total === undefined
      ? { totalCheck: "the proforma carried no total to compare with" }
      : await readBack((ref) => deps.oblio.getInvoice({ ...q, ref }), "invoice", issued, { total: proforma.total });
  return { ...issued, fromProforma: proforma, ...check, idempotencyKey: sent.idempotencyKey, companyCif: q.cif };
};

/**
 * An act on an existing invoice answers with the document Oblio acted on; that
 * it is the one asked for is checked, not assumed, and the answer names the
 * company too, so what was cancelled or deleted is never a guess.
 */
export const actedOn = <T extends DocumentRef>(asked: DocumentRef, answered: T, what: string): T =>
  sameDocument(asked, answered)
    ? answered
    : fail(
        apiError(200, `Oblio reports it ${what} invoice ${label(answered)}, not ${label(asked)} as asked; check both in Oblio`, {
          reason: DRIFT,
        }),
      );

/** An existing invoice, by series and number, with the total the caller expects of it when one is given. */
export type Target = { readonly ref: DocumentRef; readonly expectTotal?: string | undefined };

/**
 * The invoice as it stands, read BEFORE it is acted on, so the answer says
 * what was cancelled, restored or deleted (its total, its PDF), and a caller
 * who gave `expect_total` is refused, with nothing changed, when the number
 * names another invoice than the one meant.
 */
const before = async (deps: Deps, cif: string, target: Target): Promise<DocumentView> => {
  const view = await deps.oblio.getInvoice({ cif, ref: target.ref });
  const expected = target.expectTotal;
  if (expected !== undefined && (view.total === undefined || !sameAmount(view.total, expected)))
    fail(inputError(`invoice ${label(target.ref)} totals ${view.total ?? "(no total)"}, not the expected ${expected}; nothing was changed`));
  return view;
};

const wasBefore = (view: DocumentView) => ({ total: view.total, link: view.link });

/** Reversible with restoreInvoice, and the number stays in the series. */
export const cancelInvoice = async (deps: Deps, target: Target) => {
  const q = await scope(deps);
  const was = await before(deps, q.cif, target);
  return { ...actedOn(target.ref, await deps.oblio.cancelInvoice({ ...q, ref: target.ref }), "cancelled"), before: wasBefore(was), companyCif: q.cif };
};

export const restoreInvoice = async (deps: Deps, target: Target) => {
  const q = await scope(deps);
  const was = await before(deps, q.cif, target);
  return { ...actedOn(target.ref, await deps.oblio.restoreInvoice({ ...q, ref: target.ref }), "restored"), before: wasBefore(was), companyCif: q.cif };
};

/**
 * Delete a document for good. Oblio allows it only for the last number in a
 * series, and anything already filed with ANAF stays filed, so a delete can
 * leave the two out of step. It is a `money` tool (mcp/policy.ts): the client
 * asks the user to approve each call.
 */
export const deleteInvoice = async (deps: Deps, target: Target) => {
  const q = await scope(deps);
  const was = await before(deps, q.cif, target);
  const deleted = await numbered(deps, undefined, () => deps.oblio.deleteInvoice({ ...q, ref: target.ref }));
  return { deleted: { ...actedOn(target.ref, deleted, "deleted"), ...wasBefore(was) }, companyCif: q.cif };
};
