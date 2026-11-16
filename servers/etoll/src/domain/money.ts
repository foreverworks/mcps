import { compare, DECIMAL_TEXT, exactNumberText, formatDecimal, placesOf, sum, toDecimal } from "@foreverworks/mcp-kit";

import { drift, fail } from "./errors.js";
import type { PriceWire } from "./schema.js";

/**
 * Amounts, never floats. eToll's client holds prices as doubles, so they
 * arrive as JSON numbers; each becomes its exact text here, at the edge, and
 * a number that may already have lost digits (more than 15 significant, or
 * in exponent form) is `drift` rather than a guess. From then on an amount
 * is a decimal string, compared and added with the kit's decimal arithmetic.
 * Every price eToll shows is in lei. Pure.
 */

export const CURRENCY = "RON";

/** The exact text of an amount eToll sent, or undefined when it sent none. */
export const amountText = (value: number | string | null | undefined, what: string): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return exactNumberText(value) ?? fail(drift(`${what}: ${String(value)} cannot be read as an exact amount`));
  const t = value.trim();
  return DECIMAL_TEXT.test(t) ? t : fail(drift(`${what}: "${value}" is not an amount`));
};

export type Price = {
  readonly total: string;
  readonly vat: string | null;
  readonly vatPercent: string | null;
  readonly withoutVat: string | null;
  readonly currency: typeof CURRENCY;
};

/** A price eToll sent, its total required: a price without one is drift, not zero. */
export const priceOf = (p: PriceWire | null | undefined, what: string): Price => {
  const total = amountText(p?.totalPrice, `${what} total`) ?? fail(drift(`${what} has no totalPrice`));
  return {
    total,
    vat: amountText(p?.vat, `${what} VAT`) ?? null,
    vatPercent: amountText(p?.vatPercentage, `${what} VAT rate`) ?? null,
    withoutVat: amountText(p?.priceWithoutVat, `${what} without VAT`) ?? null,
    currency: CURRENCY,
  };
};

/** A price that may be absent (a toll in a list), as an answer shows it. */
export const priceView = (p: PriceWire | null | undefined, what: string) => {
  if (p === null || p === undefined || p.totalPrice === null || p.totalPrice === undefined) return null;
  const price = priceOf(p, what);
  return { total: price.total, vat: price.vat, vat_percent: price.vatPercent, without_vat: price.withoutVat, currency: price.currency };
};

export const sameAmount = (a: string, b: string): boolean => compare(toDecimal(a), toDecimal(b)) === 0;

export const sumAmounts = (amounts: readonly string[]): string => formatDecimal(sum(amounts.map(toDecimal)));

/** An amount with at least two decimals, as a person reads lei ("150" is "150.00"); never rounded. */
export const shownAmount = (amount: string): string => {
  const places = placesOf(amount);
  if (places >= 2) return amount;
  return places === 0 ? `${amount}.00` : `${amount}0`;
};
