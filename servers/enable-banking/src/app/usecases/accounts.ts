import { parseAccountUid } from "../../domain/accounts.js";
import { balance } from "../../domain/balances.js";
import { expiryOf, expiryPhrase } from "../../domain/dates.js";
import { fail, inputError, notFound } from "../../domain/errors.js";
import { liveAccountUids, reconcileAccounts, type StoredSession } from "../../domain/sessions.js";
import type { Deps } from "../ports.js";

/** The account summary when no stored consent names the uid: a live consent can reach more than this server was told. */
export const NOT_STORED = "not in any stored consent: list_accounts shows what each consent reaches";

/**
 * Sessions are keyed by a label the operator chose, so a wrong one is an
 * everyday mistake rather than an exceptional one. Listing the labels that DO
 * exist turns "no such session" into an answer instead of a dead end. No label
 * means the one stored consent; with several, the caller names one.
 */
export const requireSession = async (deps: Deps, label: string | undefined): Promise<StoredSession> => {
  const { sessions } = await deps.sessions.read();
  const known = sessions.map((s) => s.label);
  if (label === undefined) {
    const [only, ...others] = sessions;
    if (only !== undefined && others.length === 0) return only;
    return only === undefined
      ? fail(notFound("no consent is stored yet; run start_auth, then complete_auth"))
      : fail(inputError(`${sessions.length} consents are stored; name one with label: ${known.join(", ")}`));
  }
  const found = sessions.find((s) => s.label === label);
  if (found !== undefined) return found;
  return fail(
    notFound(
      `no stored session labelled "${label}"; ${
        known.length === 0 ? "none are stored yet, so run start_auth" : `stored labels are: ${known.join(", ")}`
      }`,
    ),
  );
};

/**
 * Every stored consent, and above all when each one ends: a lapsed consent is
 * discovered as a 422 on a statement that worked yesterday, and renewing it
 * needs the account holder and their bank app, so the date is the thing to
 * show early.
 */
export const listStoredSessions = async ({ sessions, now }: Deps) => {
  const book = await sessions.read();
  return {
    count: book.sessions.length,
    sessions: book.sessions.map((s) => {
      const expiry = expiryOf(s.validUntil, now());
      return {
        label: s.label,
        sessionId: s.sessionId,
        bank: s.bank ?? "not recorded",
        psuType: s.psuType ?? "not recorded",
        expires: expiryPhrase(expiry),
        ...(expiry === undefined ? {} : expiry),
        accounts: s.accounts,
      };
    }),
    ...(book.unreadable.length === 0
      ? {}
      : { unreadable: book.unreadable, note: "these entries name no session id; they are left on disk untouched" }),
  };
};

/**
 * Both sources, because neither is enough on its own.
 *
 * The live session says which accounts the consent still covers and nothing
 * about what they are: GET /sessions/{id} returns bare uid strings. The IBAN
 * and the name exist only in the response to the code exchange, which is what
 * the stored consent holds. Reading either alone gives you rows with no IBAN,
 * or a list that keeps claiming access the bank has since withdrawn.
 */
export const listAccounts = async (deps: Deps, { label }: { readonly label?: string | undefined }) => {
  const stored = await requireSession(deps, label);
  const live = await deps.bank.getSession(stored.sessionId);
  return {
    ok: true,
    label: stored.label,
    sessionId: stored.sessionId,
    status: live.status,
    expires: expiryPhrase(expiryOf(live.access.valid_until, deps.now())),
    ...reconcileAccounts(stored.accounts, liveAccountUids(live)),
  };
};

/**
 * The account a uid names, as the stored consents describe it, so an answer
 * says WHICH account it read (IBAN, currency, name) and not only an opaque uid.
 * A uid no stored consent lists is still asked for: a live consent can reach
 * an account this server holds no details for.
 */
export const storedAccount = async (deps: Deps, uid: string) => {
  const { sessions } = await deps.sessions.read();
  for (const session of sessions) {
    const account = session.accounts.find((a) => a.uid === uid);
    if (account !== undefined) return { label: session.label, ...account };
  }
  return undefined;
};

/**
 * The balances as the bank lists them, every type it sends, each the exact
 * string it came as. One read at the bank, like a statement; the uid is
 * checked for its form first so a wrong one costs nothing.
 */
export const getBalances = async (deps: Deps, args: { readonly accountUid: string }) => {
  const accountUid = parseAccountUid(args.accountUid);
  const account = await storedAccount(deps, accountUid);
  const rows = await deps.bank.getBalances(accountUid);
  return { ok: true, accountUid, account: account ?? NOT_STORED, count: rows.length, balances: rows.map(balance) };
};
