import { compare, parseDecimal, toDecimal, type Decimal } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";
import type { Direction, Transaction } from "./transactions.js";

/**
 * Narrowing a statement after it has been read.
 *
 * The bank offers no search: a statement is every row in a date range. So these
 * filters run here, on rows already fetched, and cost no extra read at the bank.
 * That matters, because the bank allows only a few unattended reads per account
 * a day: asking "what did we pay this supplier" should not spend one per
 * question.
 */

export type TransactionFilter = {
  /** Found in the counterparty's name or IBAN, the payment reference, or the entry reference. */
  readonly text?: string | undefined;
  readonly direction?: Direction | undefined;
  /** Bounds on the amount's SIZE, sign ignored: direction says which way the money went. Inclusive. */
  readonly amountMin?: string | undefined;
  readonly amountMax?: string | undefined;
};

export type FilterArgs = {
  readonly text?: string | undefined;
  readonly direction?: Direction | undefined;
  readonly amount_min?: string | undefined;
  readonly amount_max?: string | undefined;
};

/**
 * Letters compared the way a person reads them: case and diacritics ignored, so
 * "stefan" finds "ȘTEFAN SRL" and "Ştefan" (the cedilla spelling banks still
 * send) alike.
 */
export const folded = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase();

/** IBANs are printed in groups of four; a search for one should not care where the spaces went. */
const squeezed = (text: string): string => text.replace(/\s+/g, "");

const bound = (name: string, text: string | undefined): Decimal | undefined => {
  if (text === undefined || text.trim() === "") return undefined;
  const value = parseDecimal(text.trim());
  if (value === undefined || value.units < 0n) {
    return fail(inputError(`${name} must be a plain, non-negative decimal such as "250" or "1200.50" (no sign, no thousands separator); got ${JSON.stringify(text)}`));
  }
  return value;
};

/** The filter the arguments ask for, checked; `undefined` when they ask for none. */
export const parseFilter = (args: FilterArgs): TransactionFilter | undefined => {
  const text = args.text?.trim() === "" ? undefined : args.text?.trim();
  const min = bound("amount_min", args.amount_min);
  const max = bound("amount_max", args.amount_max);
  if (min !== undefined && max !== undefined && compare(min, max) > 0) {
    return fail(inputError(`amount_min (${args.amount_min}) is larger than amount_max (${args.amount_max}), so nothing could match`));
  }
  const filter: TransactionFilter = {
    ...(text === undefined ? {} : { text }),
    ...(args.direction === undefined ? {} : { direction: args.direction }),
    ...(min === undefined ? {} : { amountMin: args.amount_min?.trim() }),
    ...(max === undefined ? {} : { amountMax: args.amount_max?.trim() }),
  };
  return Object.keys(filter).length === 0 ? undefined : filter;
};

const sizeOf = (amount: string | undefined): Decimal | undefined => {
  if (amount === undefined) return undefined;
  const value = parseDecimal(amount);
  if (value === undefined) return undefined;
  return value.units < 0n ? { units: -value.units, scale: value.scale } : value;
};

export type Verdict = "match" | "no_match" | "amount_unreadable";

/**
 * Whether one row passes. A row whose amount could not be read exactly (it
 * carries an amountWarning) cannot be said to be above or below anything, so
 * under an amount bound it is neither kept nor silently dropped: it is counted,
 * and the answer says how many there were.
 */
export const verdictOf = (filter: TransactionFilter, row: Transaction): Verdict => {
  if (filter.direction !== undefined && row.direction !== filter.direction) return "no_match";
  if (filter.text !== undefined) {
    const wanted = folded(filter.text);
    const haystack = [row.counterpartyName, row.remittance, row.reference].filter((v): v is string => v !== undefined).map(folded);
    const inText = haystack.some((field) => field.includes(wanted));
    const inIban = row.counterpartyIban !== undefined && folded(squeezed(row.counterpartyIban)).includes(folded(squeezed(filter.text)));
    if (!inText && !inIban) return "no_match";
  }
  if (filter.amountMin !== undefined || filter.amountMax !== undefined) {
    const size = row.amountWarning === undefined ? sizeOf(row.amount) : undefined;
    if (size === undefined) return "amount_unreadable";
    if (filter.amountMin !== undefined && compare(size, toDecimal(filter.amountMin)) < 0) return "no_match";
    if (filter.amountMax !== undefined && compare(size, toDecimal(filter.amountMax)) > 0) return "no_match";
  }
  return "match";
};

/** The rows that pass, and how many could not be judged against an amount bound. */
export const applyFilter = <Row extends Transaction>(
  filter: TransactionFilter,
  rows: readonly Row[],
): { readonly kept: readonly Row[]; readonly amountUnreadable: number } => {
  const verdicts = rows.map((row) => [row, verdictOf(filter, row)] as const);
  return {
    kept: verdicts.filter(([, v]) => v === "match").map(([row]) => row),
    amountUnreadable: verdicts.filter(([, v]) => v === "amount_unreadable").length,
  };
};
