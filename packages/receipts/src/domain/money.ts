import { formatDecimal, parseDecimal } from "@foreverworks/mcp-kit";

/**
 * Money as integer minor units (cents, bani), never as a float.
 *
 * A card row only joins to an order on EXACT equality, so every amount is
 * turned into an integer the moment it arrives and stays one until it is
 * printed. How it arrives is each app's: Bolt sends JSON numbers (bolt-food's
 * domain/money.ts rounds them), Glovo sends Romanian display strings (glovo's
 * domain/money.ts parses them digit by digit). What leaves is the same. The
 * decimal arithmetic itself is the kit's (packages/mcp-kit, decimal.ts); this is
 * its binding to two places and a JavaScript integer.
 */

const PLACES = 2;

/**
 * Amounts leave these servers as decimal STRINGS ("42.50"): a consumer that
 * parses a number back into a float has at least been told it is doing so. MISSING IS NOT ZERO: an amount
 * the app did not send stays undefined, and a real zero prints as "0.00".
 */
export function formatMinor(minor: number): string;
export function formatMinor(minor: number | undefined): string | undefined;
export function formatMinor(minor: number | undefined): string | undefined {
  return minor === undefined ? undefined : formatDecimal({ units: BigInt(minor), scale: PLACES });
}

/**
 * A decimal as a bank export writes it, or as `formatMinor` printed it:
 * "42.50", "42,50", "-42.50", "42" -> minor units. Anything else (a currency
 * suffix, a thousands separator, a third decimal) is undefined, NOT zero.
 */
export const parseBankAmount = (text: string): number | undefined => {
  const decimal = parseDecimal(text.trim().replace(",", "."));
  if (decimal === undefined || decimal.scale > PLACES) return undefined;
  return Number(decimal.units * 10n ** BigInt(PLACES - decimal.scale));
};

/** A currency code as the tools print it. An absent one is "", which pairs with nothing. */
export const currencyOf = (code: string | undefined): string => (code ?? "").toUpperCase();
