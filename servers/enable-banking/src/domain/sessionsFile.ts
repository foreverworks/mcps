import { list, record, text } from "./json.js";
import type { RawAuthorizedSession } from "./schema.js";

/**
 * THE format of sessions.json: the single definition the writer (the session
 * store), the reader (domain/sessions.ts) and the format test
 * (test/sessionsFile.test.ts) all use.
 *
 * One entry per label, and each entry is the POST /sessions response exactly
 * as Enable Banking sent it, so another program can read the consent this
 * server stored without knowing this server. What such a reader needs per entry:
 *
 * - `session_id`: a non-blank string, or the entry is skipped;
 * - `aspsp.name` and a two-letter `aspsp.country`;
 * - `psu_type`: `business` or `personal`;
 * - `access.valid_until`: the consent's end, as ISO 8601;
 * - `accounts`: the account objects, each with `uid` and `identification_hash`
 *   (and `identification_hashes`), which identifies an account across
 *   consents, so a renewal can be linked to the history of the one it
 *   replaces. The IBAN is at `account_id.iban`; a card account may have none.
 *
 * The file is written pretty-printed with two spaces, at mode 0600.
 */
export type SessionEntry = RawAuthorizedSession;
export type SessionsFile = Readonly<Record<string, SessionEntry>>;

/**
 * What a value lacks to be a complete SessionEntry, as sentences; empty means
 * it is one. complete_auth reports these at the one
 * moment they can still be fixed, and the reader uses the same test to decide
 * whether an entry is in the current format or an older one.
 */
export const entryGaps = (value: unknown): readonly string[] => {
  const entry = record(value);
  if (entry === undefined) return ["the entry is not a JSON object"];
  const aspsp = record(entry["aspsp"]);
  const country = text(aspsp?.["country"])?.toUpperCase();
  const psuType = text(entry["psu_type"])?.toLowerCase();
  const validUntil = text(record(entry["access"])?.["valid_until"]);
  const accounts = entry["accounts"];
  return [
    ...(text(entry["session_id"]) === undefined ? ["no session_id: a reader skips the entry"] : []),
    ...(text(aspsp?.["name"]) === undefined ? ["no aspsp.name"] : []),
    ...(country === undefined || !/^[A-Z]{2}$/.test(country) ? ["no two-letter aspsp.country"] : []),
    ...(psuType !== "business" && psuType !== "personal" ? ["psu_type is neither business nor personal"] : []),
    ...(validUntil === undefined || Number.isNaN(Date.parse(validUntil)) ? ["no readable access.valid_until"] : []),
    ...(Array.isArray(accounts) ? [] : ["accounts is not a list"]),
    ...list(accounts).flatMap((account, i) => {
      const fields = record(account);
      if (fields === undefined) return [`accounts[${i}] is not an object`];
      return text(fields["identification_hash"]) === undefined
        ? [`accounts[${i}] has no identification_hash, so a renewal cannot re-link it`]
        : [];
    }),
  ];
};

/** The value as a SessionEntry, when it is one (no gaps). */
export const asSessionEntry = (value: unknown): SessionEntry | undefined =>
  entryGaps(value).length === 0 ? (value as SessionEntry) : undefined;

/**
 * The file with one label set to a new entry and every other label carried over
 * exactly as it was parsed, whatever shape an older program left it in.
 */
/** The file without one label, every other label carried over exactly as it was parsed. */
export const withoutEntry = (file: Readonly<Record<string, unknown>>, label: string): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(file).filter(([key]) => key !== label));

export const withEntry = (
  file: Readonly<Record<string, unknown>>,
  label: string,
  entry: SessionEntry,
): Readonly<Record<string, unknown>> => ({ ...file, [label]: entry });
