import { centsArg, type CentsArg, decimalOf, usd } from "./cents.js";

/**
 * What a money call charges the moment it runs (or, for a payment link,
 * opens a charge for), and which of the account's monthly API caps counts it
 * (GET /account/apiSettings): `spend` for a purchase (registrations,
 * renewals, transfers, closeouts, mailboxes), `topup` for credit added over
 * the API. The confirmation line (src/mcp/policy.ts) and the check
 * before the call (src/app/spendLimit.ts) read the amount through the same
 * field, so the dollars a user approves are the cents the check weighs.
 *
 * Left out on purpose, so the vendor's own check decides:
 * - `create_hosting`: a domain's first provision is a free trial, a
 *   re-provision charges at once, and the arguments do not say which.
 * - `top_up_account_credit` without `amount_cents`: the account's configured
 *   amount, which the arguments do not carry.
 * - `configure_auto_topup`, `update_auto_renew`: future charges, none now.
 */

export type Cap = "spend" | "topup";

/** A money argument: its `_cents` name and the legacy alias the vendor still takes. */
export type CentsField = { readonly name: string; readonly legacy: string };

export const PURCHASE_COST: CentsField = { name: "cost_cents", legacy: "cost" };
export const TOP_UP_AMOUNT: CentsField = { name: "amount_cents", legacy: "amount" };

export type Charge = { readonly cap: Cap; readonly field: CentsField };

export const CHARGED_NOW: Readonly<Record<string, Charge>> = {
  register_domain: { cap: "spend", field: PURCHASE_COST },
  renew_domain: { cap: "spend", field: PURCHASE_COST },
  transfer_domain: { cap: "spend", field: PURCHASE_COST },
  buy_closeout: { cap: "spend", field: PURCHASE_COST },
  create_mailbox: { cap: "spend", field: PURCHASE_COST },
  renew_mailbox: { cap: "spend", field: PURCHASE_COST },
  top_up_account_credit: { cap: "topup", field: TOP_UP_AMOUNT },
  top_up_with_card_mpp: { cap: "topup", field: TOP_UP_AMOUNT },
};

/** The field's value in these arguments, as the vendor will read it. */
export const amountOf = (args: Readonly<Record<string, unknown>>, field: CentsField): CentsArg => centsArg(args, field.name, field.legacy);

/**
 * The amount this call would charge now, in cents; undefined when it charges
 * nothing now (a dry run, a tool not in CHARGED_NOW) or when the amount is not
 * one the vendor would send (absent, or two names that disagree: the vendor
 * refuses those itself before anything is sent).
 */
export const chargeOf = (tool: string, args: Readonly<Record<string, unknown>>): { readonly cap: Cap; readonly cents: number } | undefined => {
  const charge = CHARGED_NOW[tool];
  if (charge === undefined || args["dry_run"] === true) return undefined;
  const amount = amountOf(args, charge.field);
  return amount.kind === "cents" && Number.isSafeInteger(amount.cents) ? { cap: charge.cap, cents: amount.cents } : undefined;
};

/**
 * One of the account's monthly caps, as Porkbun reports it: capped (by the
 * account holder, or Porkbun's $100 default), or not capped at all. `used` is
 * what this month already counts against it (`spent`, or `added` for
 * top-ups), `remaining` what is left.
 */
export type CapState =
  | { readonly capped: false }
  | { readonly capped: true; readonly source: "account" | "default"; readonly limit: number; readonly used: number; readonly remaining: number };

/** Porkbun's error code for each cap, which the vendor would answer with after sending the call. */
export const CAP_CODE: Readonly<Record<Cap, string>> = { spend: "MONTHLY_SPEND_LIMIT_EXCEEDED", topup: "TOPUP_LIMIT_EXCEEDED" };

const CAP_NAME: Readonly<Record<Cap, string>> = { spend: "monthly API spend limit", topup: "monthly API top-up limit" };
const USED_NAME: Readonly<Record<Cap, string>> = { spend: "spent", topup: "added" };
const SOURCE_NAME = { account: "set by the account holder", default: "Porkbun's default for an account that set none" } as const;

/** Why this charge is over the cap, or undefined when it fits (or nothing caps it). Integer cents only: no amount passes through a float. */
export const overCap = (tool: string, charge: { readonly cap: Cap; readonly cents: number }, state: CapState): string | undefined => {
  if (!state.capped || charge.cents <= state.remaining) return undefined;
  return (
    `${tool} would charge ${usd(charge.cents)}, more than the ${usd(state.remaining)} left of this month's ${CAP_NAME[charge.cap]} ` +
    `(${usd(state.limit)}, ${SOURCE_NAME[state.source]}; ${usd(state.used)} ${USED_NAME[charge.cap]} so far); nothing was sent to Porkbun`
  );
};

/** The figures behind a refusal, as exact decimal strings in US dollars. */
export const capFigures = (charge: { readonly cents: number }, state: CapState & { readonly capped: true }) => ({
  currency: "USD" as const,
  charge: decimalOf(charge.cents),
  limit: decimalOf(state.limit),
  used: decimalOf(state.used),
  remaining: decimalOf(state.remaining),
  source: state.source,
});
