/**
 * Exact decimal arithmetic, for amounts, prices, quantities and rates.
 *
 * Money never touches a float. A JavaScript double holds 15 to 17 significant
 * digits and says nothing when it loses one (`0.1 + 0.2` is
 * `0.30000000000000004`), and these servers feed invoices, tax filings and
 * accounting. A decimal here is an integer count of 10^-scale units in a
 * bigint: `"119.00"` is `{ units: 11900n, scale: 2 }`. Every function is pure,
 * and nothing rounds unless the caller asks, naming the rule.
 */

export type Decimal = { readonly units: bigint; readonly scale: number };

/**
 * How to round a value that falls between two representable ones.
 * - `half-up`: halves go away from zero (commercial rounding, PHP's round()).
 * - `half-even`: halves go to the even neighbour (banker's rounding).
 */
export type Rounding = "half-up" | "half-even";

/**
 * A plain decimal as text: optional minus, 1-15 digits, optional point and 1-8
 * digits. No exponent, no thousands separator, no comma, no whitespace.
 */
export const DECIMAL_TEXT = /^-?\d{1,15}(\.\d{1,8})?$/;

export const parseDecimal = (text: string): Decimal | undefined => {
  if (!DECIMAL_TEXT.test(text)) return undefined;
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const units = BigInt(`${whole}${fraction}`);
  return { units: negative ? -units : units, scale: fraction.length };
};

/** For text already validated against DECIMAL_TEXT; anything else is a bug and throws. */
export const toDecimal = (text: string): Decimal => {
  const parsed = parseDecimal(text);
  if (parsed === undefined) throw new TypeError(`not a plain decimal: ${JSON.stringify(text)}`);
  return parsed;
};

/** Digits after the point, as written: `"119.00"` has 2. */
export const placesOf = (text: string): number => text.split(".")[1]?.length ?? 0;

const pow10 = (n: number): bigint => 10n ** BigInt(n);

const widen = (d: Decimal, scale: number): bigint => d.units * pow10(scale - d.scale);

export const ZERO: Decimal = { units: 0n, scale: 0 };

export const add = (a: Decimal, b: Decimal): Decimal => {
  const scale = Math.max(a.scale, b.scale);
  return { units: widen(a, scale) + widen(b, scale), scale };
};

export const sub = (a: Decimal, b: Decimal): Decimal => add(a, { units: -b.units, scale: b.scale });

export const mul = (a: Decimal, b: Decimal): Decimal => ({ units: a.units * b.units, scale: a.scale + b.scale });

export const sum = (values: readonly Decimal[]): Decimal => values.reduce(add, ZERO);

/** An integer quotient, rounded by `mode`. The one place a division happens. */
export const divideRounded = (numerator: bigint, denominator: bigint, mode: Rounding): bigint => {
  if (denominator === 0n) throw new RangeError("division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const twice = (n % d) * 2n;
  const up = twice > d || (twice === d && (mode === "half-up" || q % 2n === 1n));
  const magnitude = up ? q + 1n : q;
  return negative ? -magnitude : magnitude;
};

/** Round to `scale` digits after the point. Widening is exact and needs no rule. */
export const round = (d: Decimal, scale: number, mode: Rounding): Decimal =>
  scale >= d.scale
    ? { units: widen(d, scale), scale }
    : { units: divideRounded(d.units, pow10(d.scale - scale), mode), scale };

/** `a * b / c` rounded once to `scale`, with no intermediate rounding. */
export const mulDiv = (a: Decimal, b: Decimal, c: Decimal, scale: number, mode: Rounding): Decimal => ({
  units: divideRounded(a.units * b.units * pow10(c.scale + scale), c.units * pow10(a.scale + b.scale), mode),
  scale,
});

const HUNDRED: Decimal = { units: 100n, scale: 0 };

/** `percent`% of `amount`: the tax on a net amount. */
export const percentOf = (amount: Decimal, percent: Decimal, scale: number, mode: Rounding): Decimal =>
  mulDiv(amount, percent, HUNDRED, scale, mode);

/** The `percent`% tax already inside a tax-inclusive `gross`: gross x p / (100 + p). */
export const percentWithin = (gross: Decimal, percent: Decimal, scale: number, mode: Rounding): Decimal =>
  mulDiv(gross, percent, add(HUNDRED, percent), scale, mode);

export const compare = (a: Decimal, b: Decimal): -1 | 0 | 1 => {
  const diff = sub(a, b).units;
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
};

/** Canonical text with exactly `scale` digits after the point. Never `-0`. */
export const formatDecimal = (d: Decimal): string => {
  const negative = d.units < 0n;
  const digits = (negative ? -d.units : d.units).toString().padStart(d.scale + 1, "0");
  const whole = d.scale === 0 ? digits : digits.slice(0, -d.scale);
  return `${negative ? "-" : ""}${whole}${d.scale === 0 ? "" : `.${digits.slice(-d.scale)}`}`;
};

/**
 * The exact text of a number an API sent bare, or undefined when it cannot be
 * trusted: any decimal of at most 15 significant digits survives JSON parsing
 * and prints back unchanged; beyond that, or in exponent form, digits may
 * already be gone, and presenting the value as exact would be a lie.
 */
export const exactNumberText = (n: number): string | undefined => {
  if (!Number.isFinite(n)) return undefined;
  const text = String(n);
  if (!DECIMAL_TEXT.test(text)) return undefined;
  const significant = text.replace(/[-.]/g, "").replace(/^0+/, "");
  return significant.length <= 15 ? text : undefined;
};
