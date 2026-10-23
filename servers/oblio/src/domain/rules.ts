import { compare, parseDecimal, placesOf, toDecimal } from "@foreverworks/mcp-kit";

import type { Collect, DocumentDraft, InvoiceDraft, ProductLine } from "./document.js";
import { fail, inputError } from "./errors.js";

/**
 * The rules a document must keep before it is worth sending, which the input
 * schema cannot express because they span fields. Each one is a generic 400
 * from Oblio otherwise, or worse, a document Oblio accepts and rounds into
 * something other than what the user confirmed.
 */

const ZERO = toDecimal("0");
const HUNDRED = toDecimal("100");

const lineProblems = (line: ProductLine, index: number, precision: number): readonly string[] => {
  const at = `products[${index}] (${line.name})`;
  const price = parseDecimal(line.price);
  const quantity = parseDecimal(line.quantity);
  const rate = parseDecimal(line.vatPercentage);
  return [
    ...(price === undefined ? [`${at}: price "${line.price}" is not a decimal`] : []),
    ...(quantity === undefined ? [`${at}: quantity "${line.quantity}" is not a decimal`] : []),
    ...(rate === undefined ? [`${at}: vat_percentage "${line.vatPercentage}" is not a decimal`] : []),
    // Oblio rounds a price to the document's precision without saying so, and
    // the total the user confirmed would no longer be the one issued.
    ...(price !== undefined && placesOf(line.price) > precision
      ? [`${at}: price ${line.price} has more than ${precision} decimals; raise precision or round it`]
      : []),
    ...(quantity !== undefined && placesOf(line.quantity) > precision
      ? [`${at}: quantity ${line.quantity} has more than ${precision} decimals; raise precision or round it`]
      : []),
    ...(price !== undefined && compare(price, ZERO) < 0 ? [`${at}: price is negative`] : []),
    ...(quantity !== undefined && compare(quantity, ZERO) <= 0 ? [`${at}: quantity must be above zero`] : []),
    ...(rate !== undefined && (compare(rate, ZERO) < 0 || compare(rate, HUNDRED) > 0)
      ? [`${at}: vat_percentage must be between 0 and 100`]
      : []),
  ];
};

const collectProblems = (collect: Collect | undefined): readonly string[] => {
  if (collect === undefined) return [];
  if (collect.type === "Chitanta" && collect.seriesName === undefined)
    return ["collect: a Chitanta needs series_name, the receipt series from list_series"];
  if (collect.type !== "Chitanta" && collect.documentNumber === undefined)
    return [`collect: a ${collect.type} needs document_number, the payment's own reference`];
  return collect.value !== undefined && parseDecimal(collect.value) === undefined
    ? [`collect: value "${collect.value}" is not a decimal`]
    : [];
};

/** ISO dates compare correctly as strings. */
const notBefore = (later: string | undefined, earlier: string | undefined, what: string): readonly string[] =>
  later !== undefined && earlier !== undefined && later < earlier ? [what] : [];

export const documentProblems = (draft: DocumentDraft): readonly string[] => [
  ...(draft.products.length === 0 ? ["products: a document needs at least one line"] : []),
  ...draft.products.flatMap((line, i) => lineProblems(line, i, draft.precision)),
  ...(draft.exchangeRate !== undefined && parseDecimal(draft.exchangeRate) === undefined
    ? [`exchange_rate "${draft.exchangeRate}" is not a decimal`]
    : []),
  ...notBefore(draft.dueDate, draft.issueDate, "due_date is before issue_date"),
];

export const invoiceProblems = (draft: InvoiceDraft): readonly string[] => [
  ...documentProblems(draft),
  ...collectProblems(draft.collect),
];

/** Fail the call, naming every problem at once rather than one per round trip. */
export const ensureValid = (problems: readonly string[]): void => {
  if (problems.length > 0) fail(inputError(`the document was not sent: ${problems.join("; ")}`));
};
