import { addDays, formatDecimal, type Rounding, toDecimal } from "@foreverworks/mcp-kit";

import { converted, DEFAULT_PLACES, type RateRule } from "../../domain/convert.js";
import { checkedDate } from "../../domain/dates.js";
import { fail, inputError } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import { currencyOf, inForceOn, pendingNote, today } from "./fixings.js";

export type ConvertArgs = {
  /** A plain decimal, already checked against DECIMAL_TEXT. */
  readonly amount: string;
  readonly from: string;
  readonly to: string;
  readonly date: string | undefined;
  readonly rateRule: RateRule;
  readonly rounding: Rounding;
  readonly places: number | undefined;
};

/**
 * An amount converted to or from RON at BNR's rate: the one in force on the
 * day, or the last one strictly before it, rounded once by the named rule.
 * Answers the rate and its publication date beside the result, so the
 * conversion can be stated and checked.
 */
export const convert = async (deps: Deps, args: ConvertArgs) => {
  const from = currencyOf(args.from);
  const to = currencyOf(args.to);
  if (from === to) fail(inputError(`from and to are both ${from}; there is nothing to convert`));
  if (from !== "RON" && to !== "RON")
    fail(inputError(`BNR's rates are RON per unit of a currency, so one side is RON: convert ${from} to RON, then RON to ${to}, and say both rates`));
  const currency = from === "RON" ? to : from;
  const now = today(deps);
  const date = args.date === undefined ? now : checkedDate(args.date, now);
  const found = await inForceOn(deps, currency, args.rateRule === "in_force" ? date : addDays(date, -1));
  const places = args.places ?? DEFAULT_PLACES;
  const result = formatDecimal(converted(toDecimal(args.amount), found.rate, from === "RON" ? "from_ron" : "to_ron", places, args.rounding));
  const which = args.rateRule === "in_force" ? `in force on ${date}` : `the last before ${date}`;
  return {
    ok: true as const,
    amount: args.amount,
    from,
    to,
    result,
    date,
    rate_rule: args.rateRule,
    rate: found.rate.value,
    multiplier: found.rate.multiplier,
    published_on: found.fixing.date,
    rounding: args.rounding,
    places,
    meaning:
      `${args.amount} ${from} = ${result} ${to} at BNR's ${currency} rate ${found.rate.value} RON for ${found.rate.multiplier} ${currency}, ` +
      `published on ${found.fixing.date} (${which}), rounded ${args.rounding} to ${places} places`,
    ...(args.rateRule === "in_force" ? pendingNote(date, now, found.fixing.date) : {}),
    source: "https://curs.bnr.ro/",
  };
};
