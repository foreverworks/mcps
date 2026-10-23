import { type Decimal, formatDecimal, mulDiv, sum, toDecimal } from "@foreverworks/mcp-kit";

import { drift, fail } from "./errors.js";

/**
 * BNR's reference rates, as its XML publishes them: one fixing per banking
 * day, each currency's rate as RON per `multiplier` units (100 for HUF, JPY,
 * KRW and a few others), with four decimals. Rates stay the exact text BNR
 * published; an average is computed in exact decimals and rounded once, half
 * up, to BNR's four. Pure.
 */

export type Rate = { readonly value: string; readonly multiplier: number };

/** One banking day's publication. `date` is YYYY-MM-DD. */
export type Fixing = { readonly date: string; readonly rates: Readonly<Record<string, Rate>> };

/** The places BNR publishes rates and averages with. */
export const PLACES = 4;

/** The rate in force on `date`: the last fixing on or before it that has the currency (a weekend or a holiday takes the banking day before). */
export const inForce = (fixings: readonly Fixing[], currency: string, date: string): { readonly fixing: Fixing; readonly rate: Rate } | undefined => {
  let found: { readonly fixing: Fixing; readonly rate: Rate } | undefined;
  for (const fixing of fixings) {
    if (fixing.date > date) continue;
    const rate = fixing.rates[currency];
    if (rate !== undefined && (found === undefined || fixing.date > found.fixing.date)) found = { fixing, rate };
  }
  return found;
};

/** One currency's fixings on one multiplier, oldest first. */
export type Series = {
  readonly currency: string;
  readonly multiplier: number;
  readonly fixings: readonly { readonly date: string; readonly rate: string }[];
};

/**
 * Each of `currencies`' fixings in `fixings`, oldest first, in the order the
 * currencies are given. A currency whose multiplier changed gets one series per
 * multiplier, so a rate is never read on the wrong basis; one with no fixing
 * gets none.
 */
export const seriesOf = (fixings: readonly Fixing[], currencies: readonly string[]): readonly Series[] => {
  const sorted = [...fixings].sort((a, b) => a.date.localeCompare(b.date));
  return currencies.flatMap((currency) => {
    const series: { currency: string; multiplier: number; fixings: { date: string; rate: string }[] }[] = [];
    for (const fixing of sorted) {
      const rate = fixing.rates[currency];
      if (rate === undefined) continue;
      const last = series.at(-1);
      if (last !== undefined && last.multiplier === rate.multiplier) last.fixings.push({ date: fixing.date, rate: rate.value });
      else series.push({ currency, multiplier: rate.multiplier, fixings: [{ date: fixing.date, rate: rate.value }] });
    }
    return series;
  });
};

/** The fixing in force on `date` whatever the currency: the last one on or before it. */
export const fixingOn = (fixings: readonly Fixing[], date: string): Fixing | undefined =>
  fixings.reduce<Fixing | undefined>((found, fixing) => (fixing.date <= date && (found === undefined || fixing.date > found.date) ? fixing : found), undefined);

const ONE: Decimal = { units: 1n, scale: 0 };

/** The mean of `values`, rounded once, half up, to `places`. */
export const mean = (values: readonly Decimal[], places: number = PLACES): Decimal => mulDiv(sum(values), ONE, { units: BigInt(values.length), scale: 0 }, places, "half-up");

export type MonthlyAverage = { readonly month: string; readonly average: string; readonly days: number; readonly multiplier: number };

/**
 * A currency's monthly averages in one year's fixings: the mean of the month's
 * daily rates, to four places, as BNR publishes them ("Serii lunare - valori
 * medii"). Months without a rate for the currency are left out.
 */
export const monthlyAverages = (fixings: readonly Fixing[], currency: string): readonly MonthlyAverage[] => {
  const months = new Map<string, Rate[]>();
  for (const fixing of [...fixings].sort((a, b) => a.date.localeCompare(b.date))) {
    const rate = fixing.rates[currency];
    if (rate !== undefined) months.set(fixing.date.slice(0, 7), [...(months.get(fixing.date.slice(0, 7)) ?? []), rate]);
  }
  return [...months].map(([month, rates]) => {
    const multipliers = new Set(rates.map((r) => r.multiplier));
    if (multipliers.size > 1) fail(drift(`BNR changed ${currency}'s multiplier within ${month}; its average needs a rule this server does not have`));
    return { month, average: formatDecimal(mean(rates.map((r) => toDecimal(r.value)))), days: rates.length, multiplier: rates[0]?.multiplier ?? 1 };
  });
};

/**
 * The annual average ANAF converts a year's foreign income at (the D212's
 * "cursul de schimb mediu anual comunicat de BNR"): the mean of the twelve
 * monthly averages, to four places, as BNR publishes it ("Serii anuale -
 * valori medii"), not the mean of the daily rates. Checked against BNR's
 * published USD 2020-2023 and EUR 2022 (README).
 */
export const annualAverage = (months: readonly MonthlyAverage[]): string => formatDecimal(mean(months.map((m) => toDecimal(m.average))));
