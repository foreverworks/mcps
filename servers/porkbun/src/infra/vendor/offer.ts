/**
 * What this server leaves out of the vendor's catalog, beyond the sandbox
 * tools its live-key profile already drops, and how the tools it keeps are
 * told so. Pure: vendor.ts hands in the vendor's own strings, parsed.
 *
 * Left out (docs/feature-plan.md, Rejected): paying in USDC over x402, which
 * needs a wallet key in the service's environment or a checkout paid
 * somewhere this server cannot see, and minting API keys, which hands the
 * calling agent a live key pair.
 */

/** Each tool not offered, and why: the README's table, and the note a description that names one gets. */
export const LEFT_OUT: Readonly<Record<string, string>> = {
  top_up_with_usdc: "adds credit in USDC on Base over x402, a crypto payment this server does not make",
  get_usdc_topup_status: "reads a USDC checkout, which nothing here opens",
  request_api_key:
    "starts minting a live API key pair, and its answer (`requestToken`, `codeVerifier`) is all anyone needs to collect the key, so it would hand the calling agent a live key",
  retrieve_api_key: "hands the calling agent a live API key pair",
};

/** Purchase arguments not offered: paying the purchase itself in USDC over x402. */
export const LEFT_OUT_PARAMS: readonly string[] = ["pay_with_usdc", "usdc_checkout_id"];

/** The vendor's text that offers USDC, which this server's descriptions must not carry. */
const OFFERS_USDC = new RegExp(`\\b(?:${LEFT_OUT_PARAMS.join("|")})\\b`);

/**
 * The vendor's purchase-funding paragraph (FUNDING_LOCAL), told for this
 * server: credit, or the user's card through Stripe Link, and no USDC.
 */
export const FUNDING =
  "**How a purchase is paid.** From prepaid account credit by default; a card saved at Porkbun is never charged by a purchase itself. " +
  "Or directly by card, for this one purchase: `pay_with_card: true` (the user's card from their Stripe Link agent wallet, held and charged only if the purchase succeeds). " +
  "Paying in USDC over x402 is not offered on this server. If the credit is short, the call fails with `INSUFFICIENT_FUNDS` carrying `cost`, `balance`, " +
  "`shortfall` and **`topUpAvailable`** (`dry_run: true` reports the same without charging). Ways forward, simplest first, always telling the user the dollar " +
  "amount and getting their OK: (1) if they use Stripe Link, retry this exact call with `pay_with_card: true`; (2) when `topUpAvailable` is true a card is saved: " +
  "`top_up_account_credit` (`amount_cents` at least `topUpAmountToCover`, or omit it for their configured amount), then retry; (3) add credit with " +
  "`top_up_with_card_mpp` (Link), then retry; (4) the user adds credit at https://porkbun.com/account/credit. If a purchase fails with VERIFICATION_REQUIRED, " +
  "the phone (`send_phone_verification_code` then `confirm_phone_verification`) and the email (`send_email_verification_code` then " +
  "`confirm_email_verification`) can both be verified without leaving the conversation, the user reading out each code. Suggest `configure_auto_topup` if " +
  "they want credit refilled automatically. Money parameters are integer cents: state amounts to the user in dollars (`cost_cents: 1108` is $11.08). If you " +
  "do not move money on a user's behalf, hand it back instead: tell them the shortfall and that they can add it with **buy account credit** at " +
  "https://porkbun.com/account/credit, then retry once they have.";

/** The vendor's opening of a purchase's description, told without USDC. */
const CARD_ONLY_OPENING = ", or pays directly by card (`pay_with_card`)";

/** The vendor's strings this rewrites, from its dist/tools.js. */
export type VendorFundingText = {
  readonly fundingLocal: string;
  readonly payWithUsdcNote: string;
  readonly payDirectOpening: string;
  readonly payDirectParams: readonly string[];
};

const leftOutNote = (named: readonly string[]): string =>
  `\n\nNot offered on this server: ${named.map((name) => `\`${name}\` (${LEFT_OUT[name] as string})`).join("; ")}.`;

/**
 * A kept tool's description, told for this server: the funding paragraph
 * and the USDC note replaced, and a note naming any left-out tool it
 * mentions. Throws, stopping the server, when the vendor offers USDC in words
 * this does not recognise: a description must not offer what was left out.
 */
export const describedHere = (name: string, description: string, vendor: VendorFundingText): string => {
  const told = description
    .split(vendor.fundingLocal)
    .join(FUNDING)
    .split(vendor.payWithUsdcNote)
    .join("")
    .split(vendor.payDirectOpening)
    .join(CARD_ONLY_OPENING);
  if (OFFERS_USDC.test(told)) throw new Error(`porkbun: the vendor's ${name} still offers USDC payment in its description; src/infra/vendor/offer.ts must follow it`);
  const named = Object.keys(LEFT_OUT).filter((tool) => tool !== name && new RegExp(`\\b${tool}\\b`).test(told));
  return named.length === 0 ? told : `${told}${leftOutNote(named)}`;
};

/** A kept tool's arguments, less the left-out ones; throws when the vendor renamed one, so a new name is not offered unnoticed. */
export const paramsHere = <S>(name: string, schema: Readonly<Record<string, S>>, vendor: VendorFundingText): Readonly<Record<string, S>> => {
  const unknown = LEFT_OUT_PARAMS.filter((param) => !vendor.payDirectParams.includes(param));
  if (unknown.length > 0) throw new Error(`porkbun: the vendor no longer names ${unknown.join(", ")} among its payment arguments; src/infra/vendor/offer.ts must follow it`);
  const kept = Object.entries(schema).filter(([param]) => !LEFT_OUT_PARAMS.includes(param));
  const stray = kept.map(([param]) => param).filter((param) => /usdc|x402/i.test(param));
  if (stray.length > 0) throw new Error(`porkbun: the vendor's ${name} takes ${stray.join(", ")}, a USDC payment argument this server does not know; src/infra/vendor/offer.ts must follow it`);
  return Object.fromEntries(kept);
};
