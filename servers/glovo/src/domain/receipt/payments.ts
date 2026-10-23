import { formatMinor } from "@foreverworks/receipts/domain";

import { amountIn } from "../money.js";
import type { RawPaymentLeg } from "../schema.js";

/**
 * Where the money for one order came from.
 *
 * Glovo's legs carry `amount: null`, always. The amount is in the sentence, and
 * only when the order was split: "307,47 RON was charged on your card ending in
 * 1234." next to "5,00 RON was paid with Glovo credits". A single-leg order
 * says just "Was charged on your card ending in 1234", and that leg paid the
 * whole total. So every leg takes the amount its text states, and AT MOST ONE
 * leg without one takes the remainder of the total. Two silent legs stay
 * unknown rather than being guessed apart.
 *
 * Method, from `type` and the wording:
 * - CREDIT_CARD is a card.
 * - OTHER "Paid with Apple Pay" / Google Pay is a wallet, which charges a card,
 *   so it counts toward the card leg.
 * - OTHER "Paid with Cash" (ro "Plătit cu Numerar") is cash and does NOT reach
 *   a bank statement.
 * - GLOVO_CREDIT is Glovo credits.
 */
export type Method = "card" | "wallet" | "glovo_credit" | "cash" | "other";

export type Leg = {
  readonly method: Method;
  readonly provider?: string;
  readonly label?: string;
  readonly minor?: number;
  readonly last4?: string;
  /** "Will be charged on your card" (ro "Se va debita"): an order still in progress. */
  readonly pending: boolean;
};

const WALLET = /apple pay|google pay/i;
const CASH = /\bcash\b|numerar/i;
const PENDING = /will be charged|se va debita/i;
const LAST4 = /(?:ending in|terminația|se termină cu)\s+(\d{4})\b/i;

const methodOf = (raw: RawPaymentLeg): Method => {
  const text = raw.text ?? "";
  switch (raw.type) {
    case "CREDIT_CARD":
      return "card";
    case "GLOVO_CREDIT":
      return "glovo_credit";
    default:
      if (WALLET.test(text)) return "wallet";
      if (CASH.test(text)) return "cash";
      return "other";
  }
};

const legOf = (raw: RawPaymentLeg): Leg => {
  const text = raw.text ?? undefined;
  const stated = amountIn(text);
  const last4 = text?.match(LAST4)?.[1];
  return {
    method: methodOf(raw),
    ...(raw.provider ? { provider: raw.provider } : {}),
    ...(text ? { label: text } : {}),
    ...(stated ? { minor: stated.minor } : {}),
    ...(last4 ? { last4 } : {}),
    pending: PENDING.test(text ?? ""),
  };
};

/** Every leg with its amount: stated, or the remainder of the total for the one silent leg. */
export const legsOf = (raw: readonly RawPaymentLeg[], totalMinor: number | undefined): readonly Leg[] => {
  const legs = raw.map(legOf);
  const silent = legs.filter((l) => l.minor === undefined);
  if (silent.length !== 1 || totalMinor === undefined) return legs;
  const stated = legs.reduce((sum, l) => sum + (l.minor ?? 0), 0);
  return legs.map((l) => (l.minor === undefined ? { ...l, minor: totalMinor - stated } : l));
};

const CARD_METHODS: ReadonlySet<Method> = new Set(["card", "wallet"]);

/** A sum over legs; undefined if any leg in it has no known amount. Missing is not zero. */
const sum = (legs: readonly Leg[]): number | undefined =>
  legs.reduce<number | undefined>((acc, l) => (acc === undefined || l.minor === undefined ? undefined : acc + l.minor), 0);

export type Charged = {
  readonly card: number | undefined;
  readonly glovoCredit: number | undefined;
  readonly cash: number | undefined;
  readonly other: number | undefined;
};

/** Per method group. No legs at all (a cancelled order) is zero everywhere: nothing was taken. */
export const chargedOf = (legs: readonly Leg[]): Charged => ({
  card: sum(legs.filter((l) => CARD_METHODS.has(l.method))),
  glovoCredit: sum(legs.filter((l) => l.method === "glovo_credit")),
  cash: sum(legs.filter((l) => l.method === "cash")),
  other: sum(legs.filter((l) => l.method === "other")),
});

/** The card's last four digits, when any card leg names them. */
export const cardLast4 = (legs: readonly Leg[]): string | undefined => legs.find((l) => l.last4)?.last4;

export const paymentView = (leg: Leg) => ({
  method: leg.method,
  ...(leg.provider ? { provider: leg.provider } : {}),
  ...(leg.label ? { label: leg.label } : {}),
  amount: formatMinor(leg.minor),
  ...(leg.pending ? { pending: true } : {}),
});
