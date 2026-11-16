import { toDecimal } from "@foreverworks/mcp-kit";

/**
 * The ECB's euro foreign exchange reference rates: one fixing per TARGET
 * working day, around 16:00 CET, each currency as units of that currency per
 * 1 EUR. Rates stay the exact text the ECB published, minus trailing zeros
 * (its daily file writes `365.60` where its history writes `365.6`, the same
 * number), so one fixing reads alike whichever file it came from. Pure.
 */

/** One working day's publication. `date` is YYYY-MM-DD; `rates` maps a currency to units per 1 EUR. */
export type Fixing = { readonly date: string; readonly rates: Readonly<Record<string, string>> };

/** The reference currency: every rate is against it, and it has no rate of its own. */
export const BASE = "EUR";

/** A plain decimal without trailing zeros: `365.60` is `365.6`, `13111` stays. The value is untouched. */
export const withoutTrailingZeros = (text: string): string => (text.includes(".") ? text.replace(/\.?0+$/, "") : text);

/** The positive decimal a rate is, or undefined when the ECB's text is not one (zero converts nothing, a minus is no rate). */
export const positiveRate = (text: string): string | undefined => {
  if (!/^\d{1,15}(\.\d{1,8})?$/.test(text)) return undefined;
  return toDecimal(text).units > 0n ? withoutTrailingZeros(text) : undefined;
};

/**
 * Every fixing of every list, oldest first, one per date; where lists share a
 * date the later list wins, so a fresh small file corrects the big one's tail.
 */
export const merged = (...lists: readonly (readonly Fixing[])[]): readonly Fixing[] => {
  const byDate = new Map<string, Fixing>();
  for (const list of lists) for (const fixing of list) byDate.set(fixing.date, fixing);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * The fixing in force on `date`: the last one on or before it, so a weekend, a
 * TARGET holiday and the hours before 16:00 take the working day before. The
 * fixings are oldest first.
 */
export const fixingOn = (fixings: readonly Fixing[], date: string): Fixing | undefined => fixings.findLast((fixing) => fixing.date <= date);

/** The fixings dated `from` to `to`, both included, with only `currencies` in them (all when undefined); a fixing left with no rate is dropped. */
export const windowOf = (fixings: readonly Fixing[], from: string, to: string, currencies: readonly string[] | undefined): readonly Fixing[] =>
  fixings
    .filter((fixing) => fixing.date >= from && fixing.date <= to)
    .map((fixing): Fixing => ({
      date: fixing.date,
      rates: currencies === undefined ? fixing.rates : Object.fromEntries(currencies.flatMap((c) => (fixing.rates[c] === undefined ? [] : [[c, fixing.rates[c]]]))),
    }))
    .filter((fixing) => Object.keys(fixing.rates).length > 0);

/** How many rates the fixings hold. */
export const countOf = (fixings: readonly Fixing[]): number => fixings.reduce((n, fixing) => n + Object.keys(fixing.rates).length, 0);

/** The currencies a fixing carries against the euro, alphabetically. */
export const currenciesOf = (fixing: Fixing): readonly string[] => Object.keys(fixing.rates).sort();
