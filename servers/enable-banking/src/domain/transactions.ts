import type { RawAccountRef, RawTransaction } from "./schema.js";

/**
 * A bank transaction, once the PSD2 shape is behind us.
 *
 * Two rules here are the whole reason this file exists, and both are pure
 * functions of one row.
 */

export type Direction = "credit" | "debit";

/** The schema makes the indicator required: `DBIT` is money leaving, anything else money arriving. */
export const directionOf = (indicator: string): Direction => (indicator.toUpperCase() === "DBIT" ? "debit" : "credit");

/**
 * Amounts stay decimal STRINGS, and get a sign.
 *
 * NOTHING here converts money to a JavaScript number, and nothing adds two
 * amounts. A double holds 15-17 significant digits, so `9007199254740993.01`
 * comes back as `9007199254740992` and `0.1 + 0.2` is `0.30000000000000004`:
 * both are silent, and a statement that is silently wrong is worse than one
 * that failed. Signing is a string operation for exactly that reason. Callers
 * that need arithmetic should parse to integer minor units themselves, and can,
 * because what they are handed is still exact.
 *
 * The sign itself is the other half. The API sends an unsigned amount plus a
 * separate credit/debit indicator, so every consumer that wants a ledger has to
 * combine them, and any consumer that forgets books a payment as income.
 */

/** A plain decimal, which is all this API is documented to send. */
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

const sign = (magnitude: string, direction: Direction): string => {
  const bare = magnitude.startsWith("-") ? magnitude.slice(1) : magnitude;
  // No "-0": a zero-value entry is neither money in nor money out.
  if (/^0(?:\.0+)?$/.test(bare)) return bare;
  return direction === "debit" ? `-${bare}` : bare;
};

export type Amount =
  | { readonly ok: true; readonly value: string }
  /** Kept verbatim: a figure this code does not understand is not a figure to guess at. */
  | { readonly ok: false; readonly value: string; readonly reason: string };

/** An amount as the API sent it, exact or flagged; no sign applied (a balance carries its own). */
export const amountText = (raw: string | number | undefined): Amount | undefined => {
  if (raw === undefined) return undefined;

  if (typeof raw === "number") {
    // Precision is already gone: JSON.parse made this a double before any of
    // this ran. Say so rather than dressing it up as an exact figure.
    return { ok: false, value: String(raw), reason: "the bank sent a JSON number, so the value passed through a float and may be inexact" };
  }

  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!DECIMAL.test(trimmed)) return { ok: false, value: trimmed, reason: "not a plain decimal; passed through unaltered" };
  return { ok: true, value: trimmed };
};

/** A transaction amount, signed by its direction. */
export const parseAmountText = (raw: string | number | undefined, direction: Direction): Amount | undefined => {
  const amount = amountText(raw);
  if (amount === undefined) return undefined;
  // A figure not understood is passed on as it came, unsigned: nothing is guessed about it.
  return amount.ok || typeof raw === "number" ? { ...amount, value: sign(amount.value, direction) } : amount;
};

/** Absent and null both mean "the bank did not say": `undefined`, never the string "null". */
const ibanOf = (ref: RawAccountRef | null | undefined): string | undefined =>
  ref?.iban ?? ref?.other?.identification ?? undefined;

/**
 * The counterparty is whichever side of the transfer is NOT this account, and
 * which side that is depends on the direction.
 *
 * A row names both a debtor and a creditor, and on a debit the account being
 * read IS the debtor: taking `debtor_account` as "the counterparty" gives back
 * the account's own IBAN. That trap silently reconciles a statement against
 * itself.
 */
export const counterparty = (
  raw: RawTransaction,
  direction: Direction,
): { readonly name?: string | undefined; readonly iban?: string | undefined } =>
  direction === "debit"
    ? { name: raw.creditor?.name ?? undefined, iban: ibanOf(raw.creditor_account) }
    : { name: raw.debtor?.name ?? undefined, iban: ibanOf(raw.debtor_account) };

/**
 * Banks split the payment reference across lines at arbitrary points, and the
 * identifiers a reconciliation needs often straddle the split. Joining with a
 * single space makes a search work; keeping the lines would make every consumer
 * join them first.
 */
export const remittanceText = (lines: readonly string[] | null | undefined): string | undefined => {
  const joined = (lines ?? [])
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  return joined === "" ? undefined : joined;
};

export type Transaction = {
  readonly reference: string | undefined;
  readonly direction: Direction;
  /** Signed decimal STRING: negative for money leaving the account. Never a number. */
  readonly amount: string | undefined;
  /** Present only when the figure could NOT be taken at face value. */
  readonly amountWarning?: string | undefined;
  readonly currency: string;
  readonly status: string;
  readonly bookingDate: string | undefined;
  readonly valueDate: string | undefined;
  readonly counterpartyName: string | undefined;
  readonly counterpartyIban: string | undefined;
  readonly remittance: string | undefined;
  readonly bankCode: string | undefined;
  readonly merchantCategoryCode: string | undefined;
};

/**
 * One row, mapped. `transaction_amount`, `credit_debit_indicator` and `status`
 * are required by the schema and read as such; every optional field the bank
 * leaves out, or sends as null, comes out as `undefined` and is dropped from
 * the JSON rather than reported as an empty string.
 */
export const transaction = (raw: RawTransaction): Transaction => {
  const direction = directionOf(raw.credit_debit_indicator);
  const other = counterparty(raw, direction);
  const amount = parseAmountText(raw.transaction_amount.amount, direction);
  return {
    reference: raw.entry_reference ?? raw.transaction_id ?? undefined,
    direction,
    amount: amount?.value,
    // Absent on every ordinary row, which is the point: a key that is always
    // there stops being read.
    ...(amount === undefined || amount.ok ? {} : { amountWarning: amount.reason }),
    currency: raw.transaction_amount.currency,
    status: raw.status,
    bookingDate: raw.booking_date ?? undefined,
    valueDate: raw.value_date ?? undefined,
    counterpartyName: other.name,
    counterpartyIban: other.iban,
    remittance: remittanceText(raw.remittance_information),
    bankCode: raw.bank_transaction_code?.code ?? undefined,
    merchantCategoryCode: raw.merchant_category_code ?? undefined,
  };
};
