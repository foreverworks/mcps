import { addDays } from "@foreverworks/mcp-kit";

import { checkedDate } from "../../domain/dates.js";
import { BASE } from "../../domain/rates.js";
import type { Deps } from "../ports.js";
import { currencyOf, inForceOn, pendingNote, rateIn, SOURCE, today } from "./fixings.js";

/**
 * The rate in force on `date`: the ECB's fixing of that day, or of the last
 * working day before it (a weekend, a TARGET holiday, or a day whose fixing is
 * not out yet: the ECB publishes around 16:00 CET). Answers the fixing's own
 * date, so a caller sees which publication it got.
 */
export const rate = async (deps: Deps, args: { readonly currency: string; readonly date: string | undefined }) => {
  const currency = currencyOf(args.currency);
  const now = today(deps);
  const date = args.date === undefined ? now : checkedDate(args.date, now);
  const fixing = await inForceOn(deps, date);
  const value = rateIn(fixing, currency);
  return {
    ok: true as const,
    currency,
    date,
    rate: value,
    fixing_date: fixing.date,
    meaning:
      currency === BASE
        ? `1 EUR is 1 EUR: the euro is the base every ECB rate is quoted against; the fixing in force on ${date} is the one of ${fixing.date}`
        : `1 EUR = ${value} ${currency}, the ECB's euro foreign exchange reference rate of ${fixing.date}${fixing.date === date ? "" : `, the last fixing before ${date}`}`,
    ...pendingNote(date, now, fixing.date),
    source: SOURCE,
  };
};

/** Whether the ECB answers: its latest fixing, its date and how many currencies it carries. */
export const health = async (deps: Deps) => {
  const fixing = (await deps.rates.latest()).fixings.at(-1);
  const now = today(deps);
  return {
    ok: true as const,
    source: SOURCE,
    latest_fixing: fixing?.date,
    currencies: fixing === undefined ? 0 : Object.keys(fixing.rates).length,
    today: now,
    ...(fixing !== undefined && fixing.date < addDays(now, -5) ? { warning: `the latest fixing is from ${fixing.date}, more than five days ago` } : {}),
  };
};
