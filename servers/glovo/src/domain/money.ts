/**
 * Glovo's amounts, into integer minor units (packages/receipts, domain/money.ts
 * takes it from there).
 *
 * Glovo sends every amount as a display STRING in Romanian number format:
 * "312,47 RON", "1.234,56 RON", "-64,20 RON", and "No cost" (ro "Fără costuri")
 * for a free delivery, "GRATUIT" (en "Free") for a free product line. They are parsed digit by digit into an integer and stay
 * one until they are printed, because a card row only joins to an order on
 * exact equality.
 */

export type Amount = { readonly minor: number; readonly currency?: string };

/**
 * The words Glovo writes instead of "0,00", compared case-insensitively. "No
 * cost" is a free delivery line (e.g. Prime); "GRATUIT" is a free product's
 * line price.
 */
const ZERO_WORDS: ReadonlySet<string> = new Set(["no cost", "fără costuri", "fara costuri", "free", "gratuit"]);

/**
 * Units with "." thousands separators or none, a comma, exactly two decimals,
 * and a three-letter currency. The minus may be ASCII or U+2212.
 */
const BODY = String.raw`([-−]?)\s*(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})\s*([A-Z]{3})`;
const EXACT = new RegExp(`^${BODY}$`);
const ANYWHERE = new RegExp(`(?:^|[^\\d.,])${BODY}`);

const fromMatch = (m: RegExpMatchArray): Amount => {
  const [, sign = "", units = "0", cents = "00", currency = ""] = m;
  const minor = Number(units.replace(/\./g, "")) * 100 + Number(cents);
  return { minor: sign ? -minor : minor, currency };
};

/**
 * A whole display amount -> minor units. "No cost" and "Free" are zero with no currency.
 * Anything else (a label, a percentage, a malformed figure) is undefined, NOT
 * zero: missing is not free.
 */
export const parseDisplayAmount = (text: string | null | undefined): Amount | undefined => {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (ZERO_WORDS.has(trimmed.toLowerCase())) return { minor: 0 };
  const m = trimmed.match(EXACT);
  return m ? fromMatch(m) : undefined;
};

/** The first amount inside a sentence: "307,47 RON was charged on your card ending in 1234." */
export const amountIn = (text: string | null | undefined): Amount | undefined => {
  if (typeof text !== "string") return undefined;
  const m = text.match(ANYWHERE);
  return m ? fromMatch(m) : undefined;
};
