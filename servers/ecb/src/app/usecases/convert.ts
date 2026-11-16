import { formatDecimal, type Rounding, toDecimal } from "@foreverworks/mcp-kit";

import { checkedDate } from "../../domain/dates.js";
import { converted, DEFAULT_PLACES, perEuro } from "../../domain/convert.js";
import { fail, inputError } from "../../domain/errors.js";
import { BASE } from "../../domain/rates.js";
import type { Deps } from "../ports.js";
import { currencyOf, inForceOn, pendingNote, rateIn, SOURCE, today } from "./fixings.js";

export type ConvertArgs = {
  /** A plain decimal, already checked against DECIMAL_TEXT. */
  readonly amount: string;
  readonly from: string;
  readonly to: string;
  readonly date: string | undefined;
  readonly rounding: Rounding;
  readonly places: number | undefined;
};

/** The arithmetic, as text: the euro to a currency multiplies by its rate, a currency to the euro divides by it, two currencies go through the euro. */
const formulaOf = (amount: string, from: string, to: string, rateOf: (currency: string) => string | undefined): string =>
  from === BASE ? `${amount} x ${rateOf(to)}` : to === BASE ? `${amount} / ${rateOf(from)}` : `${amount} x ${rateOf(to)} / ${rateOf(from)}`;

/**
 * An amount converted between two currencies at the ECB's fixing in force on a
 * day, computed exactly from the fixing's rates and rounded once by the named
 * rule. Any pair works: the euro to a currency or back, or two currencies
 * through the euro, both rates from the same fixing. Answers the rates, the
 * fixing's date and the rule beside the result, so the conversion can be
 * stated and checked.
 */
export const convert = async (deps: Deps, args: ConvertArgs) => {
  const from = currencyOf(args.from);
  const to = currencyOf(args.to);
  if (from === to) fail(inputError(`from and to are both ${from}; there is nothing to convert`));
  const now = today(deps);
  const date = args.date === undefined ? now : checkedDate(args.date, now);
  const fixing = await inForceOn(deps, date);
  const places = args.places ?? DEFAULT_PLACES;
  const legs = [from, to].filter((c) => c !== BASE).map((currency) => ({ currency, rate: rateIn(fixing, currency) }));
  const rateOf = (currency: string): string | undefined => legs.find((l) => l.currency === currency)?.rate;
  const result = formatDecimal(converted(toDecimal(args.amount), perEuro(from, rateOf(from)), perEuro(to, rateOf(to)), places, args.rounding));
  return {
    ok: true as const,
    amount: args.amount,
    from,
    to,
    result,
    date,
    fixing_date: fixing.date,
    rates: legs,
    rounding: args.rounding,
    places,
    meaning:
      `${args.amount} ${from} = ${result} ${to} at the ECB fixing of ${fixing.date}${fixing.date === date ? "" : ` (the last fixing before ${date})`}: ` +
      `${legs.map((l) => `1 EUR = ${l.rate} ${l.currency}`).join(" and ")}; ${formulaOf(args.amount, from, to, rateOf)}${legs.length === 2 ? ", a cross rate through the euro" : ""}, ` +
      `rounded ${args.rounding} to ${places} places`,
    ...pendingNote(date, now, fixing.date),
    source: SOURCE,
  };
};
