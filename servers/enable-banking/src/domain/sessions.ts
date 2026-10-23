import { accountSummary, type AccountSummary } from "./accounts.js";
import { type Json, list, record, text } from "./json.js";
import type { RawSession } from "./schema.js";
import { asSessionEntry, type SessionEntry } from "./sessionsFile.js";

/**
 * What a consent is worth remembering for, read back from sessions.json.
 *
 * Enable Banking hands back a session_id once, in the response to the code
 * exchange. Lose it and the only way back is another trip through the bank's
 * app with SCA, so it is written to disk before anything else happens with it.
 *
 * The format is domain/sessionsFile.ts. This module is the read side: that
 * format, and an entry with gaps in it, reduced to what the tools report.
 */
export type StoredAccount = AccountSummary & { readonly uid: string };

export type StoredSession = {
  readonly label: string;
  readonly sessionId: string;
  readonly bank?: { readonly name: string; readonly country: string } | undefined;
  readonly psuType?: string | undefined;
  readonly validUntil?: string | undefined;
  readonly accounts: readonly StoredAccount[];
};

export type SessionBook = {
  readonly sessions: readonly StoredSession[];
  /** Labels whose entry names no session id: kept on disk, never used. */
  readonly unreadable: readonly string[];
};

/** An account can be read only through its uid; one without is left out rather than shown blank. */
const withUid = (account: AccountSummary): readonly StoredAccount[] =>
  account.uid === undefined ? [] : [{ ...account, uid: account.uid }];

/** The current format, read through its one type. */
const fromEntry = (label: string, entry: SessionEntry): StoredSession => ({
  label,
  sessionId: entry.session_id,
  bank: { name: entry.aspsp.name, country: entry.aspsp.country },
  psuType: entry.psu_type,
  validUntil: entry.access.valid_until,
  accounts: entry.accounts.map(accountSummary).flatMap(withUid),
});

/**
 * An entry with a gap (entryGaps), read field by field: complete_auth stores a
 * consent the API described incompletely rather than lose its session id, and
 * a reduced entry (`accounts: [{uid, identification}]`) is still a consent.
 */
const partialAccount = (value: unknown): readonly StoredAccount[] => {
  const entry = record(value);
  const uid = text(entry?.["uid"]);
  if (entry === undefined || uid === undefined) return [];
  return [
    {
      uid,
      iban: text(record(entry["account_id"])?.["iban"]) ?? text(entry["identification"]),
      currency: text(entry["currency"]),
      name: text(entry["name"]) ?? text(entry["product"]),
    },
  ];
};

const partialSession = (label: string, entry: Json): StoredSession | undefined => {
  const sessionId = text(entry["session_id"]);
  if (sessionId === undefined) return undefined;
  const aspsp = record(entry["aspsp"]);
  const name = text(aspsp?.["name"]);
  const country = text(aspsp?.["country"]);
  return {
    label,
    sessionId,
    bank: name === undefined || country === undefined ? undefined : { name, country },
    psuType: text(entry["psu_type"]),
    validUntil: text(record(entry["access"])?.["valid_until"]),
    accounts: list(entry["accounts"]).flatMap(partialAccount),
  };
};

/**
 * One entry of sessions.json. A consent read as missing costs the account
 * holder a trip through SCA to recreate something that was never lost, so an
 * incomplete entry is read too. An entry with no session id is `undefined`: an
 * id of `undefined` produces a confusing 404, where "not stored" is honest.
 */
export const storedSession = (label: string, value: unknown): StoredSession | undefined => {
  const entry = asSessionEntry(value);
  if (entry !== undefined) return fromEntry(label, entry);
  const fields = record(value);
  return fields === undefined ? undefined : partialSession(label, fields);
};

/** Every entry of the file, in label order, with the unreadable ones named. */
export const sessionBook = (file: Json): SessionBook => {
  const labels = Object.keys(file).sort();
  const read = labels.map((label) => [label, storedSession(label, file[label])] as const);
  return {
    sessions: read.flatMap(([, session]) => (session === undefined ? [] : [session])),
    unreadable: read.flatMap(([label, session]) => (session === undefined ? [label] : [])),
  };
};

/** Which accounts the consent still covers, from both lists GET /sessions/{id} returns. */
export const liveAccountUids = (raw: RawSession): readonly string[] =>
  [...new Set([...raw.accounts, ...raw.accounts_data.map((a) => a.uid)])].filter((uid) => uid !== "");

/**
 * What the consent covers now, described with what we know about it.
 *
 * Neither source is sufficient alone: the live call says which uids are still
 * authorised and nothing about what they are, and the stored consent is the
 * only record of the IBAN and the name. A bank can drop an account from a live
 * consent, so `revoked` exists; a consent created elsewhere would produce a uid
 * we hold no details for, so `unknown` does too. Both are omitted when empty.
 */
export const reconcileAccounts = (stored: readonly StoredAccount[], liveUids: readonly string[]) => {
  const live = new Set(liveUids);
  const known = new Set(stored.map((a) => a.uid));
  const accounts = stored.filter((a) => live.has(a.uid));
  const revoked = stored.filter((a) => !live.has(a.uid)).map((a) => a.uid);
  const unknown = liveUids.filter((uid) => !known.has(uid));
  return {
    count: accounts.length,
    accounts,
    ...(revoked.length > 0 ? { revoked } : {}),
    ...(unknown.length > 0 ? { unknownToThisServer: unknown } : {}),
  };
};
