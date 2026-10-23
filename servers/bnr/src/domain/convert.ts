import { type Decimal, mulDiv, type Rounding, toDecimal } from "@foreverworks/mcp-kit";

import { drift, fail } from "./errors.js";
import type { Rate } from "./rates.js";

/**
 * An amount converted to or from RON at one of BNR's rates. BNR quotes RON per
 * `multiplier` units of a currency, so to RON is amount x rate / multiplier and
 * from RON is amount x multiplier / rate, each computed exactly and rounded
 * once, by the rule the caller names, to `places`. Pure.
 */

export type Direction = "to_ron" | "from_ron";

/** Which of BNR's fixings a conversion takes. */
export type RateRule =
  /** The fixing of the day, or of the last banking day before it: what `rate` answers. */
  | "in_force"
  /** The last fixing strictly before the day: the rule for an invoice in a foreign currency (the Fiscal Code's "ultimul curs comunicat de BNR anterior datei"). */
  | "last_before";

export const RATE_RULES = ["in_force", "last_before"] as const satisfies readonly RateRule[];
export const ROUNDINGS = ["half-up", "half-even"] as const satisfies readonly Rounding[];

/** Amounts on Romanian documents have two decimals. */
export const DEFAULT_PLACES = 2;

export const converted = (amount: Decimal, rate: Rate, direction: Direction, places: number, rounding: Rounding): Decimal => {
  const value = toDecimal(rate.value);
  if (value.units <= 0n) fail(drift(`BNR published a rate of ${rate.value}, which converts nothing`));
  const multiplier: Decimal = { units: BigInt(rate.multiplier), scale: 0 };
  return direction === "to_ron" ? mulDiv(amount, value, multiplier, places, rounding) : mulDiv(amount, multiplier, value, places, rounding);
};
