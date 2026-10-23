import { daysBetween } from "@foreverworks/mcp-kit";

import { checkedDate, FIRST_YEAR } from "../../domain/dates.js";
import { fail, inputError, notFound } from "../../domain/errors.js";
import { type Fixing, fixingOn, type Series, seriesOf } from "../../domain/rates.js";
import type { Deps } from "../ports.js";
import { currenciesIn, currencyOf, inForceOn, pendingNote, today, yearOf } from "./fixings.js";

/** A window spans at most a year, so it reads at most two of BNR's year files. */
export const MAX_WINDOW_DAYS = 366;
/** About 40 KB of answer: a year of seven currencies, or every currency for two months. */
export const MAX_RATES = 2000;

export type RatesArgs = {
  readonly currencies: readonly string[] | undefined;
  readonly date: string | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
};

const countOf = (series: readonly Series[]): number => series.reduce((n, s) => n + s.fixings.length, 0);

/** The fixing in force on `date` for any currency; the first days of January take December's. */
const fixingInForce = async (deps: Deps, date: string): Promise<Fixing> => {
  const year = Number(date.slice(0, 4));
  const found = fixingOn(await yearOf(deps, year), date) ?? (year > FIRST_YEAR ? fixingOn(await yearOf(deps, year - 1), date) : undefined);
  return found ?? fail(notFound(`BNR published no fixing on or before ${date}`));
};

/** Each currency's rate in force on one day: its own fixing, or the last banking day's before it. */
const onDay = async (deps: Deps, asked: readonly string[] | undefined, date: string, now: string) => {
  const currencies = asked ?? Object.keys((await fixingInForce(deps, date)).rates).sort();
  const found = await Promise.all(currencies.map((currency) => inForceOn(deps, currency, date)));
  const series: readonly Series[] = found.map((f, i) => ({
    currency: currencies[i] ?? "",
    multiplier: f.rate.multiplier,
    fixings: [{ date: f.fixing.date, rate: f.rate.value }],
  }));
  const latest = found.map((f) => f.fixing.date).sort().at(-1) ?? date;
  return { ok: true as const, date, series, count: series.length, ...pendingNote(date, now, latest), source: "https://curs.bnr.ro/" };
};

/** Every fixing BNR published from `from` to `to`, both included. */
const inWindow = async (deps: Deps, asked: readonly string[] | undefined, from: string, to: string) => {
  const span = daysBetween(from, to) + 1;
  if (span > MAX_WINDOW_DAYS) fail(inputError(`a window is at most ${MAX_WINDOW_DAYS} days; ${from} to ${to} is ${span}: split it`));
  const years = Array.from({ length: Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 1 }, (_, i) => Number(from.slice(0, 4)) + i);
  const read = (await Promise.all(years.map((year) => yearOf(deps, year)))).flat();
  const known = currenciesIn(read);
  const unknown = (asked ?? []).filter((c) => !known.includes(c));
  if (unknown.length > 0) fail(notFound(`BNR publishes no ${unknown.join(", ")} rate here; it publishes ${known.join(", ")}`));
  const fixings = read.filter((f) => f.date >= from && f.date <= to);
  const currencies = asked ?? currenciesIn(fixings);
  const series = seriesOf(fixings, currencies);
  const count = countOf(series);
  if (count > MAX_RATES)
    fail(inputError(`${from} to ${to} holds ${count} rates for ${currencies.length} currencies, more than the ${MAX_RATES} a call answers: name fewer currencies or a shorter window`));
  const absent = currencies.filter((c) => !series.some((s) => s.currency === c));
  return {
    ok: true as const,
    from,
    to,
    series,
    count,
    ...(absent.length > 0 && fixings.length > 0 ? { absent } : {}),
    ...(fixings.length === 0 ? { note: `BNR published no fixing from ${from} to ${to} (a weekend or holidays); give date instead for the rates in force then` } : {}),
    source: "https://curs.bnr.ro/",
  };
};

/**
 * BNR's rates as series: several currencies on one day (each one's rate in
 * force then), or every fixing in a window. Rates are BNR's exact text.
 */
export const rates = async (deps: Deps, args: RatesArgs) => {
  const now = today(deps);
  const asked = args.currencies === undefined ? undefined : [...new Set(args.currencies.map(currencyOf))];
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
