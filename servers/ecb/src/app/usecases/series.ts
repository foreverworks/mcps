import { checkedDate } from "../../domain/dates.js";
import { fail, inputError, notFound } from "../../domain/errors.js";
import { BASE, countOf, currenciesOf, type Fixing, windowOf } from "../../domain/rates.js";
import type { Deps } from "../ports.js";
import { currencyOf, fixingsFrom, inForceOn, pendingNote, SOURCE, today } from "./fixings.js";

/** About 40 KB of answer: a year of seven currencies, or every currency for two months. */
export const MAX_RATES = 2000;

export type RatesArgs = {
  readonly currencies: readonly string[] | undefined;
  readonly date: string | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
};

/** The currencies asked for, checked and without repeats; the euro is the base, not a rate. */
const currenciesAsked = (asked: readonly string[] | undefined): readonly string[] | undefined => {
  const codes = asked === undefined ? undefined : [...new Set(asked.map(currencyOf))];
  if (codes?.includes(BASE)) fail(inputError("EUR is the base every rate is quoted against, so it has no rate of its own; name the other currencies"));
  return codes;
};

/** Every currency (or those asked for) in the fixing in force on one day, all from that one fixing. */
const onDay = async (deps: Deps, asked: readonly string[] | undefined, date: string, now: string) => {
  const fixing = await inForceOn(deps, date);
  const unknown = (asked ?? []).filter((c) => fixing.rates[c] === undefined);
  if (unknown.length > 0) fail(notFound(`the ECB's fixing of ${fixing.date} carries no ${unknown.join(", ")} rate; it carries ${currenciesOf(fixing).join(", ")}`));
  const [row] = windowOf([fixing], fixing.date, fixing.date, asked);
  const fixings: readonly Fixing[] = row === undefined ? [] : [row];
  return { ok: true as const, date, fixing_date: fixing.date, fixings, count: countOf(fixings), ...pendingNote(date, now, fixing.date), source: SOURCE };
};

/** Every fixing the ECB published from `from` to `to`, both included. */
const inWindow = async (deps: Deps, asked: readonly string[] | undefined, from: string, to: string) => {
  const fixings = windowOf(await fixingsFrom(deps, from), from, to, asked);
  const count = countOf(fixings);
  if (count > MAX_RATES)
    fail(inputError(`${from} to ${to} holds ${count} rates, more than the ${MAX_RATES} a call answers: name fewer currencies or a shorter window`));
  const absent = (asked ?? []).filter((c) => !fixings.some((f) => f.rates[c] !== undefined));
  return {
    ok: true as const,
    from,
    to,
    fixings,
    count,
    ...(absent.length > 0 && fixings.length > 0 ? { absent } : {}),
    ...(fixings.length === 0
      ? { note: `the ECB published no ${asked === undefined ? "fixing" : `${asked.join(", ")} rate`} from ${from} to ${to} (a weekend, TARGET holidays, a currency it does not carry then, or not out yet); give date instead for the rates in force then` }
      : {}),
    source: SOURCE,
  };
};

/**
 * The ECB's rates as fixings, oldest first: several currencies (or all) on one
 * day, each from the fixing in force then, or every fixing in a window. Rates
 * are the ECB's exact text.
 */
export const rates = async (deps: Deps, args: RatesArgs) => {
  const now = today(deps);
  const asked = currenciesAsked(args.currencies);
  if (args.from === undefined) {
    if (args.to !== undefined) fail(inputError("to ends the window from starts: give from too, or date alone for one day"));
    return onDay(deps, asked, args.date === undefined ? now : checkedDate(args.date, now), now);
  }
  if (args.date !== undefined) fail(inputError("give date for the rates in force on one day, or from (and to) for every fixing in a window, not both"));
  const from = checkedDate(args.from, now);
  const to = args.to === undefined ? now : checkedDate(args.to, now);
  if (from > to) fail(inputError(`from (${from}) is after to (${to})`));
  return inWindow(deps, asked, from, to);
};
