import { addDays } from "@foreverworks/mcp-kit";

import { checkedDate, FIRST_YEAR } from "../../domain/dates.js";
import { fail, inputError, notFound } from "../../domain/errors.js";
import { annualAverage, monthlyAverages } from "../../domain/rates.js";
import type { Deps } from "../ports.js";
import { currenciesIn, currencyOf, inForceOn, pendingNote, today, yearOf } from "./fixings.js";

/**
 * The rate in force on `date`: BNR's fixing of that day, or of the last
 * banking day before it (a weekend, a holiday, or a day whose fixing is not
 * out yet: BNR publishes around 13:00). Answers the fixing's own date, so a
 * caller sees which publication it got.
 */
export const rate = async (deps: Deps, args: { readonly currency: string; readonly date: string | undefined }) => {
  const currency = currencyOf(args.currency);
  const now = today(deps);
  const date = args.date === undefined ? now : checkedDate(args.date, now);
  const found = await inForceOn(deps, currency, date);
  return {
    ok: true as const,
    currency,
    date,
    rate: found.rate.value,
    multiplier: found.rate.multiplier,
    published_on: found.fixing.date,
    meaning: `RON for ${found.rate.multiplier} ${currency}, BNR's reference rate published on ${found.fixing.date}${found.fixing.date === date ? "" : `, the last before ${date}`}`,
    ...pendingNote(date, now, found.fixing.date),
    source: "https://curs.bnr.ro/",
  };
};

/**
 * The annual average ANAF converts a year's foreign income at: the mean of
 * BNR's twelve monthly averages, with them. A year not over yet answers the
 * months so far with complete: false.
 */
export const annual = async (deps: Deps, args: { readonly currency: string; readonly year: number }) => {
  const currency = currencyOf(args.currency);
  const thisYear = Number(today(deps).slice(0, 4));
  if (args.year < FIRST_YEAR || args.year > thisYear) fail(inputError(`year must be between ${FIRST_YEAR} and ${thisYear}`));
  const fixings = await yearOf(deps, args.year);
  const months = monthlyAverages(fixings, currency);
  if (months.length === 0) return fail(notFound(`BNR published no ${currency} rate in ${args.year}; it publishes ${currenciesIn(fixings).join(", ")}`));
  const complete = args.year < thisYear && months.length === 12;
  const multipliers = new Set(months.map((m) => m.multiplier));
  return {
    ok: true as const,
    currency,
    year: args.year,
    average: annualAverage(months),
    multiplier: months[0]?.multiplier ?? 1,
    ...(multipliers.size > 1 ? { warning: `${currency}'s multiplier changed during ${args.year}; the months are not on one basis` } : {}),
    complete,
    ...(complete ? {} : { note: `${months.length} month(s) so far: the annual average exists once the year is over` }),
    method: "the mean of BNR's monthly averages (each the mean of the month's daily rates), rounded half up to four places, as BNR publishes its annual averages and ANAF's D212 uses them",
    months: months.map((m) => ({ month: m.month, average: m.average, days: m.days })),
    source: `https://curs.bnr.ro/files/xml/years/nbrfxrates${args.year}.xml`,
  };
};

/** Whether BNR answers: its latest fixing, its date and how many currencies. */
export const health = async (deps: Deps) => {
  const latest = await deps.rates.latest();
  const fixing = [...latest.fixings].sort((a, b) => b.date.localeCompare(a.date))[0];
  const now = today(deps);
  return {
    ok: true as const,
    source: "https://curs.bnr.ro/nbrfxrates.xml",
    latest_fixing: fixing?.date,
    currencies: fixing === undefined ? 0 : Object.keys(fixing.rates).length,
    today: now,
    ...(fixing !== undefined && fixing.date < addDays(now, -5) ? { warning: `the latest fixing is from ${fixing.date}, more than five days ago` } : {}),
  };
};
