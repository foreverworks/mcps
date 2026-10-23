import type { Fixing } from "../domain/rates.js";

/** A rates document: when BNR made it, and its fixings. */
export type RatesDocument = { readonly publishedOn: string | undefined; readonly fixings: readonly Fixing[] };

/** BNR's published rates. */
export type RatesPort = {
  /** Every fixing of `year`; `current` when the year is not over, so the file still grows. */
  readonly year: (year: number, current: boolean) => Promise<RatesDocument>;
  /** The latest fixing BNR has published. */
  readonly latest: () => Promise<RatesDocument>;
};

export type Deps = {
  readonly rates: RatesPort;
  readonly now: () => number;
  /** BNR's calendar: dates are Bucharest dates. */
  readonly timeZone: string;
};
