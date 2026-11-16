import { type Decimal, mulDiv, type Rounding, toDecimal } from "@foreverworks/mcp-kit";

import { drift, fail } from "./errors.js";
import { BASE } from "./rates.js";

/**
 * An amount converted between two currencies at one ECB fixing. A rate is units
 * of a currency per 1 EUR, so the euro is 1 and any other currency's rate r is
 * what 1 EUR buys of it: amount in X becomes amount x (Y per EUR) / (X per EUR)
 * in Y. That one formula is EUR to Y (divide by 1), X to EUR (multiply by 1)
 * and every cross rate through the euro, computed exactly and rounded once, by
 * the rule the caller names, to `places`. Both rates come from the same fixing.
 * Pure.
 */

export const ROUNDINGS = ["half-up", "half-even"] as const satisfies readonly Rounding[];

/** Amounts on invoices and statements have two decimals. */
export const DEFAULT_PLACES = 2;

const ONE: Decimal = { units: 1n, scale: 0 };

/** Units of `currency` per 1 EUR at the fixing: 1 for the euro itself. */
export const perEuro = (currency: string, rate: string | undefined): Decimal => {
  if (currency === BASE) return ONE;
  if (rate === undefined) return fail(drift(`no ${currency} rate to convert at`));
  const value = toDecimal(rate);
  if (value.units <= 0n) return fail(drift(`the ECB published a ${currency} rate of ${rate}, which converts nothing`));
  return value;
};

export const converted = (amount: Decimal, from: Decimal, to: Decimal, places: number, rounding: Rounding): Decimal => mulDiv(amount, to, from, places, rounding);
