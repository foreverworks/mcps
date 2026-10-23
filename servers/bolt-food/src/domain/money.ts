/**
 * Bolt's amounts, into integer minor units the moment they arrive.
 *
 * Bolt sends amounts as JSON numbers, and adding them drifts: 2.35 + 57.84 is
 * 60.190000000000005 as a double. So every amount is rounded to minor units
 * here, and the shared rules (packages/receipts, domain/money.ts) take it from
 * there.
 */

/**
 * MISSING IS NOT ZERO.
 *
 * This returned 0 for an absent value, so an order whose payload carried no
 * `total_price` rendered as `"0.00"` and read as a free order. Nothing in a
 * receipt is improved by inventing a figure: a field Bolt did not send is
 * absent from the result, and a real zero still prints as `0.00`.
 */
export const toMinor = (value: number | undefined | null): number | undefined =>
  value === undefined || value === null ? undefined : Math.round(value * 100);

/** For SUMS, where a leg the payload omitted contributes nothing to the total. */
export const minorOr0 = (value: number | undefined | null): number => toMinor(value) ?? 0;
