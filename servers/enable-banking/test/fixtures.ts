/**
 * Synthetic payloads in Enable Banking's shapes. Field names are those of the
 * real POST /sessions response; every value is invented: IBANs are
 * DE00SYNT... with check digits 00, which no real account has.
 */
import type { RawAccount } from "../src/domain/schema.js";
import type { SessionEntry } from "../src/domain/sessionsFile.js";

export const SESSION_ID = "00000000-0000-4000-8000-00000000abcd";
export const VALID_UNTIL = "2030-07-01T12:00:00Z";

const account = (uid: string, iban: string, currency: string, name: string, product: string, hash: string): RawAccount => ({
  account_id: { iban, other: null },
  all_account_ids: [{ identification: iban, scheme_name: "IBAN", issuer: null }],
  account_servicer: null,
  name,
  details: null,
  usage: null,
  cash_account_type: "CACC",
  product,
  currency,
  psu_status: null,
  credit_limit: null,
  legal_age: null,
  postal_address: null,
  uid,
  identification_hash: hash,
  identification_hashes: [`${hash}-short`, hash],
});

export const UIDS = [
  "11111111-2222-4333-8444-555555555501",
  "11111111-2222-4333-8444-555555555502",
  "11111111-2222-4333-8444-555555555503",
] as const;

export const ACCOUNTS = [
  account(UIDS[0], "DE00SYNT00000000000001", "EUR", "SYNTHETIC CURRENT", "SYNTHETIC BUSINESS CURRENT", "hash-eur"),
  account(UIDS[1], "DE00SYNT00000000000002", "EUR", "SYNTHETIC SAVINGS", "SYNTHETIC BUSINESS SAVINGS", "hash-savings"),
  account(UIDS[2], "DE00SYNT00000000000003", "GBP", "SYNTHETIC GBP", "SYNTHETIC BUSINESS GBP", "hash-gbp"),
] as const;

/** A code exchange for a business consent with an invented bank in DE, in the one sessions.json entry format. */
export const sessionResponse = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  session_id: SESSION_ID,
  accounts: ACCOUNTS,
  aspsp: { name: "Example Bank", country: "DE" },
  psu_type: "business",
  access: { accounts: null, balances: true, transactions: true, valid_until: VALID_UNTIL },
  ...over,
});
