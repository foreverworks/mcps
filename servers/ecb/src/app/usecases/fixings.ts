import { dateIn, FIRST_FIXING } from "../../domain/dates.js";
import { fail, inputError, notFound } from "../../domain/errors.js";
import { BASE, currenciesOf, type Fixing, fixingOn, merged } from "../../domain/rates.js";
import type { Deps } from "../ports.js";

/** What every rate tool shares: the currency code, today in Frankfurt, the fixing in force on a day, the rate a fixing holds. */

export const SOURCE = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";

export const currencyOf = (text: string): string => {
  const c = text.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : fail(inputError(`currency is an ISO 4217 code like USD or GBP, or EUR, not "${text}"`));
};

export const today = (deps: Deps): string => dateIn(deps.timeZone, deps.now());

/**
 * Fixings that include the one in force on `from` and every later one, oldest
 * first. The small files answer when they reach back to `from` (the latest
 * fixing alone, then the 90 days); only an older day reads the whole history,
 * and then the small files are laid over its tail, so a day cached in the
 * history before today's fixing was published is still answered.
 */
export const fixingsFrom = async (deps: Deps, from: string): Promise<readonly Fixing[]> => {
  const latest = await deps.rates.latest();
  if (from >= latest.fixings[0].date) return latest.fixings;
  const recent = await deps.rates.recent();
  if (from >= recent.fixings[0].date) return merged(recent.fixings, latest.fixings);
  const history = await deps.rates.history();
  return merged(history.fixings, recent.fixings, latest.fixings);
};

/** The fixing in force on `date`: that day's, or the last working day's before it. */
export const inForceOn = async (deps: Deps, date: string): Promise<Fixing> =>
  fixingOn(await fixingsFrom(deps, date), date) ?? fail(notFound(`the ECB published no fixing on or before ${date}; its series starts ${FIRST_FIXING}`));

/** `currency`'s units per 1 EUR in `fixing`; the euro itself is 1. */
export const rateIn = (fixing: Fixing, currency: string): string => {
  if (currency === BASE) return "1";
  return fixing.rates[currency] ?? fail(notFound(`the ECB's fixing of ${fixing.date} carries no ${currency} rate; it carries ${currenciesOf(fixing).join(", ")}`));
};

/** Said when today's rate was asked for and the ECB's fixing of the day is not out. */
export const pendingNote = (date: string, now: string, fixingDate: string): { readonly note?: string } =>
  date === now && fixingDate !== now
    ? { note: `the ECB publishes the day's rates around 16:00 CET; ${now}'s are not out yet or there are none (a weekend or TARGET holiday)` }
    : {};
