import {
  add,
  type Decimal,
  formatDecimal,
  mul,
  parseDecimal,
  percentOf,
  percentWithin,
  round,
  type Rounding,
  sub,
  sum,
  toDecimal,
  ZERO,
} from "./decimal.js";

/**
 * What an invoice adds up to, computed exactly. The ONE place an invoice total
 * is computed, for every server that issues or builds one (oblio issues them,
 * anaf-efactura builds the UBL): the call returns it and the line a person
 * confirms prints it, so the two cannot differ.
 *
 * The rule is EN 16931's, which ANAF validates every e-Factura against
 * (BR-CO-10, BR-S-08, BR-CO-17), and which an invoicing service therefore has
 * to follow:
 *
 * - a line's amount is quantity x price, rounded to 2 decimals;
 * - VAT is computed once per rate on the SUM of those line amounts, not per
 *   line, and rounded to 2 decimals;
 * - the total is the sum of the amounts plus the sum of the VAT.
 *
 * A VAT-inclusive price is the gross: the line's gross is quantity x price, and
 * the VAT inside a rate's gross is gross x rate / (100 + rate), rounded once.
 * Rounding is half away from zero throughout, as PHP's round() does.
 */

/** Amounts on a Romanian invoice have two decimals whatever the price precision. */
export const AMOUNT_SCALE = 2;
const RULE: Rounding = "half-up";

/** One line as the rule sees it: decimal strings in the document's currency. */
export type TaxedLine = {
  /** Per unit, with or without VAT per `vatIncluded`. */
  readonly price: string;
  readonly quantity: string;
  /** "21", "9", "0". */
  readonly vatPercentage: string;
  /** The price is the gross. Absent means it is the net. */
  readonly vatIncluded?: boolean | undefined;
  /**
   * EN 16931's VAT category (UNTDID 5305: S, Z, E, AE, K, G, O, ...). Lines of
   * one rate in two categories are totalled apart, as a VAT breakdown must be;
   * absent, a rate is one group.
   */
  readonly vatCategory?: string | undefined;
};

export type RateTotal = {
  readonly vatPercentage: string;
  readonly vatIncluded: boolean;
  /** Only when the lines name one. */
  readonly vatCategory?: string;
  readonly net: string;
  readonly vat: string;
  readonly gross: string;
};

export type DocumentTotal = {
  readonly net: string;
  readonly vat: string;
  readonly gross: string;
  readonly currency: string;
  readonly byRate: readonly RateTotal[];
};

/** "21" and "21.00" are one rate. */
const rateKey = (line: TaxedLine): string =>
  `${formatDecimal(round(toDecimal(line.vatPercentage), 4, RULE))}|${line.vatIncluded === true ? "incl" : "excl"}|${line.vatCategory ?? ""}`;

const amountOf = (line: TaxedLine): Decimal => round(mul(toDecimal(line.price), toDecimal(line.quantity)), AMOUNT_SCALE, RULE);

type Group = { readonly key: string; readonly first: TaxedLine; readonly amounts: readonly Decimal[] };

const groupsOf = (lines: readonly TaxedLine[]): readonly Group[] =>
  lines.reduce<readonly Group[]>((groups, line) => {
    const key = rateKey(line);
    return groups.some((g) => g.key === key)
      ? groups.map((g) => (g.key === key ? { ...g, amounts: [...g.amounts, amountOf(line)] } : g))
      : [...groups, { key, first: line, amounts: [amountOf(line)] }];
  }, []);

const totalOf = ({ first, amounts }: Group): { readonly net: Decimal; readonly vat: Decimal; readonly gross: Decimal } => {
  const base = sum(amounts);
  const rate = toDecimal(first.vatPercentage);
  if (first.vatIncluded === true) {
    const vat = percentWithin(base, rate, AMOUNT_SCALE, RULE);
    return { net: sub(base, vat), vat, gross: base };
  }
  const vat = percentOf(base, rate, AMOUNT_SCALE, RULE);
  return { net: base, vat, gross: add(base, vat) };
};

const fixed = (d: Decimal): string => formatDecimal(round(d, AMOUNT_SCALE, RULE));

/** An amount as a document prints it: two decimals, rounded by the rule above ("51.2700" is "51.27"). */
export const asAmount = (text: string): string => fixed(toDecimal(text));

/** A line's amount, quantity x price in two decimals: the net of a net price, the gross of a gross one. */
export const lineAmount = (line: TaxedLine): string => fixed(amountOf(line));

/** Whether every figure parses; an input schema makes this true, the check keeps a caller from throwing. */
export const computable = (lines: readonly TaxedLine[]): boolean =>
  lines.length > 0 && lines.every((l) => [l.price, l.quantity, l.vatPercentage].every((text) => parseDecimal(text) !== undefined));

export const documentTotal = (lines: readonly TaxedLine[], currency: string): DocumentTotal => {
  const groups = groupsOf(lines).map((group) => ({ group, total: totalOf(group) }));
  return {
    net: fixed(sum(groups.map((g) => g.total.net))),
    vat: fixed(sum(groups.map((g) => g.total.vat))),
    gross: fixed(sum(groups.map((g) => g.total.gross))),
    currency,
    byRate: groups.map(({ group, total }) => ({
      vatPercentage: group.first.vatPercentage,
      vatIncluded: group.first.vatIncluded === true,
      ...(group.first.vatCategory === undefined ? {} : { vatCategory: group.first.vatCategory }),
      net: fixed(total.net),
      vat: fixed(total.vat),
      gross: fixed(total.gross),
    })),
  };
};

/**
 * The total of the reversing invoice (storno) of a document that totals
 * `total`. A storno repeats every line with its quantity negated, and the rule
 * above is symmetric under negation: a line's amount negates, each rate's sum
 * and its VAT negate, and half away from zero rounds -x exactly as it rounds x.
 * So documentTotal of the negated lines is the original total, negated, which
 * the tests check on the rounding cases. A service whose document reads carry
 * no lines (Oblio's) computes the total a person confirms for a storno here.
 */
export const reversalTotal = (total: string): string => fixed(sub(ZERO, toDecimal(total)));
