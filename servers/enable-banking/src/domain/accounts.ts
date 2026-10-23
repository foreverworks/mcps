import { fail, inputError } from "./errors.js";
import { text } from "./json.js";
import type { RawAccount } from "./schema.js";

/**
 * An account as a person recognises it: which IBAN, in which currency, under
 * which name. The uid is what get_transactions takes, and it changes with every
 * consent, so it is never the thing a human is asked to compare.
 */
export type AccountSummary = {
  readonly uid?: string | undefined;
  readonly iban?: string | undefined;
  readonly currency?: string | undefined;
  readonly name?: string | undefined;
};

/**
 * `account_id.iban` first, which is where most banks put it; an IBAN-scheme entry of `all_account_ids` second. Absent in both
 * means the bank did not give one (a card account, say), reported as absent.
 */
export const ibanOf = (account: RawAccount): string | undefined =>
  text(account.account_id?.iban) ??
  (account.all_account_ids ?? []).find((id) => id.scheme_name === "IBAN" && text(id.identification) !== undefined)
    ?.identification;

/**
 * An account uid as Enable Banking issues it: a UUID, which changes with every
 * consent. Checked for its form so that an IBAN, a label or a truncated uid
 * fails here, naming what is wrong, instead of spending one of the bank's
 * daily reads on a 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const parseAccountUid = (value: string): string => {
  const uid = value.trim();
  if (!UUID.test(uid))
    fail(inputError(`account_uid "${value.slice(0, 80)}" is not an account uid; take the uid field from list_accounts (a UUID, not the IBAN)`));
  return uid;
};

/** The name, or the product when a bank leaves the name out */
export const accountSummary = (account: RawAccount): AccountSummary => ({
  uid: text(account.uid),
  iban: ibanOf(account),
  currency: text(account.currency),
  name: text(account.name) ?? text(account.product),
});

/**
 * The bank's current description wins field by field; the one in the code
 * exchange fills what it leaves out, so a details call that omits the name
 * does not erase the one the consent already reported.
 */
export const preferring = (primary: AccountSummary, fallback: AccountSummary): AccountSummary => ({
  uid: primary.uid ?? fallback.uid,
  iban: primary.iban ?? fallback.iban,
  currency: primary.currency ?? fallback.currency,
  name: primary.name ?? fallback.name,
});
