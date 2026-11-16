import type { Fixing } from "../domain/rates.js";

/** A rates document: its fixings, oldest first, at least one. */
export type RatesDocument = { readonly fixings: readonly [Fixing, ...Fixing[]] };

/** The ECB's three published files of reference rates, each a different slice of the same series. */
export type RatesPort = {
  /** The latest fixing alone: a file of one working day, kept briefly. */
  readonly latest: () => Promise<RatesDocument>;
  /** The last 90 calendar days of fixings. */
  readonly recent: () => Promise<RatesDocument>;
  /** Every fixing since 1999-01-04. Large, so read only for a day older than `recent` reaches. */
  readonly history: () => Promise<RatesDocument>;
};

export type Deps = {
  readonly rates: RatesPort;
  readonly now: () => number;
  /** The ECB's calendar: dates are Frankfurt dates. */
  readonly timeZone: string;
};
