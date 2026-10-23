import { inSeries } from "@foreverworks/mcp-kit";

import { accountSummary, preferring, type AccountSummary } from "../../domain/accounts.js";
import { authorizationCode } from "../../domain/callback.js";
import { derivedLabel, parseLabel } from "../../domain/consent.js";
import { consentValidUntil, expiryOf, expiryPhrase } from "../../domain/dates.js";
import { asAppError, consentGone, required } from "../../domain/errors.js";
import type { SessionBook } from "../../domain/sessions.js";
import { entryGaps } from "../../domain/sessionsFile.js";
import type { PsuType, RawAccount, RawAuthorizedSession } from "../../domain/schema.js";
import type { Deps } from "../ports.js";
import { requireSession } from "./accounts.js";

/**
 * Begin a consent. Returns a URL a human has to open.
 *
 * There is no way to automate the middle of this: the bank requires strong
 * customer authentication, which means a person and their phone. The tool's
 * real job is to produce the URL and say plainly what happens next.
 *
 * `access` names no accounts, which is how "all of them" is asked for: the bank
 * then lets the person pick in its own consent screen, where the bank
 * typically lists every account the person holds.
 */
export const startAuth = async (
  deps: Deps,
  args: { readonly aspspName: string; readonly aspspCountry: string; readonly psuType: PsuType; readonly state: string },
) => {
  const aspspCountry = args.aspspCountry.toUpperCase();
  const validUntil = consentValidUntil(deps.now() * 1000);
  const started = await deps.bank.startAuth({ ...args, aspspCountry, validUntil });
  return {
    ok: true,
    url: started.url,
    authorizationId: started.authorization_id,
    bank: { name: args.aspspName, country: aspspCountry },
    psuType: args.psuType,
    validUntil,
    nextStep:
      "Open url in a browser and approve in the bank's app, ticking EVERY account it offers. The bank then " +
      "redirects to this application's redirect_url with ?code=... in the query. Pass that whole redirect URL, " +
      "or just the code, to complete_auth. The code is single-use and short-lived, so do it straight away.",
  };
};

/**
 * One account for a person to check against what they approved. The details
 * come from the bank now; if that call fails, the consent is already stored,
 * so the account is reported from the code exchange with the reason attached
 * rather than failing a call whose one irreplaceable effect has happened.
 */
const describeAccount = async (deps: Deps, account: RawAccount): Promise<AccountSummary & { detailsError?: string }> => {
  const fromSession = accountSummary(account);
  if (fromSession.uid === undefined)
    return { ...fromSession, detailsError: "the bank gave this account no uid, so it cannot be read" };
  try {
    return preferring(accountSummary(await deps.bank.accountDetails(fromSession.uid)), fromSession);
  } catch (thrown) {
    const known = asAppError(thrown);
    if (known === undefined) throw thrown;
    return { ...fromSession, detailsError: known.message };
  }
};

/** One after the other: these reach the bank itself, and a burst is what its rate limit is for. */
const describeAll = (deps: Deps, accounts: readonly RawAccount[]) => inSeries(accounts, (account) => describeAccount(deps, account));

/**
 * Where a consent is stored when the caller names no label: a renewal replaces
 * the one stored consent for the same bank, country and account type, so
 * whatever reads it by its label keeps reading it; otherwise the bank and its
 * country (`example_bank_de`). Decided after the exchange, because only the
 * exchange says which bank the person approved, and never refused there,
 * because the session id is revealed once.
 */
const labelFor = (book: SessionBook, session: RawAuthorizedSession): string => {
  const same = book.sessions.filter(
    (s) =>
      s.bank !== undefined &&
      s.bank.name === session.aspsp?.name &&
      s.bank.country.toUpperCase() === session.aspsp?.country?.toUpperCase() &&
      s.psuType === session.psu_type,
  );
  const [only, ...others] = same;
  if (only !== undefined && others.length === 0) return only.label;
  return derivedLabel(session.aspsp?.name ?? "bank", session.aspsp?.country ?? "xx");
};

/**
 * Exchange the code for a session, and write it down before anything else.
 *
 * Enable Banking reveals the session_id exactly once. If this function returned
 * it without persisting it, a caller who lost the message would need another
 * trip through SCA to get back to where they already were. So the order is:
 * exchange, store (the previous file copied aside), and only then the account
 * details, which are a nicety by comparison.
 */
export const completeAuth = async (deps: Deps, args: { readonly codeOrUrl: string; readonly label?: string | undefined }) => {
  const named = args.label === undefined || args.label.trim() === "" ? undefined : parseLabel(args.label);
  const code = authorizationCode(args.codeOrUrl);
  // Read before the exchange, so a store that cannot be read fails while the code is still unspent.
  const book = await deps.sessions.read();
  const session = await deps.bank.authorizeSession(code);
  const sessionId = required(session.session_id === "" ? undefined : session.session_id, "session_id for that code");
  const label = named ?? labelFor(book, session);

  const saved = await deps.sessions.save(label, session);
  // The schema makes `accounts` and `access` required. Past this line the
  // consent is on disk, so if Enable Banking ever left one out, the answer
  // reports the gap (formatWarnings) instead of turning a stored consent
  // into an "unexpected" failure that reads as if nothing happened.
  const gaps = entryGaps(session);
  const accounts = await describeAll(deps, Array.isArray(session.accounts) ? session.accounts : []);
  const validUntil = session.access?.valid_until;
  const expiry = expiryOf(validUntil, deps.now());

  return {
    ok: true,
    storedAs: label,
    sessionId,
    bank: session.aspsp,
    psuType: session.psu_type,
    validUntil: validUntil ?? "not in the response",
    expires: expiryPhrase(expiry),
    count: accounts.length,
    accounts,
    backup: saved.backup ?? "none: there was no sessions.json before this consent",
    ...(saved.replaced === undefined
      ? {}
      : { replaced: { sessionId: saved.replaced.sessionId, validUntil: saved.replaced.validUntil ?? "not recorded" } }),
    ...(gaps.length === 0 ? {} : { formatWarnings: gaps }),
  };
};

/**
 * End a consent: at the bank first, then in sessions.json.
 *
 * The order matters. If the bank refuses, nothing local changes and the stored
 * consent still works. If the bank says the consent is already gone (lapsed,
 * revoked in the bank's own app), the entry is removed anyway, because it can
 * no longer read anything. The file as it was is kept as sessions.json.bak, so
 * a label removed by mistake is one rename away, though the consent itself is
 * not: only the account holder can grant a new one.
 */
export const revokeSession = async (deps: Deps, args: { readonly label: string }) => {
  const stored = await requireSession(deps, args.label);
  let atBank: "revoked" | "already ended" = "revoked";
  try {
    await deps.bank.deleteSession(stored.sessionId);
  } catch (thrown) {
    const error = asAppError(thrown);
    if (error === undefined || !consentGone(error)) throw thrown;
    atBank = "already ended";
  }
  const saved = await deps.sessions.remove(stored.label);
  return {
    ok: true,
    label: stored.label,
    bank: stored.bank ?? "not recorded",
    accounts: stored.accounts.length,
    atBank,
    ...(saved.backup === undefined ? {} : { backup: saved.backup }),
    nextStep: "These accounts can no longer be read. To read them again, the account holder approves a new consent: start_auth, then complete_auth.",
  };
};
