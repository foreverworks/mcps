import { dateIn, FIRST_YEAR } from "../../domain/dates.js";
import { fail, inputError, notFound } from "../../domain/errors.js";
import { type Fixing, inForce, type Rate } from "../../domain/rates.js";
import type { Deps } from "../ports.js";

/** What every rate tool shares: the currency code, today in Bucharest, a year's fixings, the rate in force on a day. */

export const currencyOf = (text: string): string => {
  const c = text.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : fail(inputError(`currency is an ISO 4217 code like EUR or USD (XAU for gold, XDR for SDR), not "${text}"`));
};

export const today = (deps: Deps): string => dateIn(deps.timeZone, deps.now());

export const yearOf = (deps: Deps, year: number): Promise<readonly Fixing[]> =>
  deps.rates.year(year, year >= Number(today(deps).slice(0, 4))).then((d) => d.fixings);

export const currenciesIn = (fixings: readonly Fixing[]): readonly string[] => [...new Set(fixings.flatMap((f) => Object.keys(f.rates)))].sort();

/**
 * The rate in force on `date`: BNR's fixing of that day, or of the last
 * banking day before it; the first days of January take December's.
 */
export const inForceOn = async (deps: Deps, currency: string, date: string): Promise<{ readonly fixing: Fixing; readonly rate: Rate }> => {
  const year = Number(date.slice(0, 4));
  if (year < FIRST_YEAR) return fail(notFound(`BNR's XML series start in ${FIRST_YEAR}; there is no ${currency} rate on or before ${date}`));
  let fixings = await yearOf(deps, year);
  let found = inForce(fixings, currency, date);
  if (found === undefined && year > FIRST_YEAR) {
    fixings = await yearOf(deps, year - 1);
    found = inForce(fixings, currency, date);
  }
  if (found === undefined) {
    const known = currenciesIn(fixings);
    return fail(notFound(known.includes(currency) ? `BNR published no ${currency} rate on or before ${date}` : `BNR publishes no ${currency} rate here; it publishes ${known.join(", ")}`));
  }
  return found;
};

/** Said when today's rate was asked for and BNR's fixing of the day is not out. */
export const pendingNote = (date: string, now: string, publishedOn: string): { readonly note?: string } =>
  date === now && publishedOn !== now ? { note: `BNR publishes the day's rate around 13:00 Bucharest; ${now}'s is not out yet or there is none (a weekend or holiday)` } : {};
