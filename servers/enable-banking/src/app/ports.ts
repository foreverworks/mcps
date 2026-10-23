/**
 * What the use cases need, stated as functions rather than objects with
 * behaviour. Everything here is an interface the infra layer satisfies; nothing
 * in app/ or domain/ ever imports from infra/.
 */
import type {
  PsuType,
  RawAccount,
  RawApplication,
  RawAspsp,
  RawAuthorizedSession,
  RawBalance,
  RawSession,
  RawStartedAuthorization,
  RawTransaction,
} from "../domain/schema.js";
import type { SessionBook, StoredSession } from "../domain/sessions.js";
import type { SessionEntry } from "../domain/sessionsFile.js";

export type AuthRequest = {
  readonly aspspName: string;
  readonly aspspCountry: string;
  readonly psuType: PsuType;
  readonly validUntil: string;
  readonly state: string;
};

export type TransactionQuery = {
  readonly accountUid: string;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly status?: string | undefined;
};

export type EnableBankingPort = {
  /** `/application`: the cheapest call that proves the key pair is accepted. */
  readonly application: () => Promise<RawApplication>;
  /** The bank catalogue. `undefined` means every market. */
  readonly listAspsps: (country: string | undefined) => Promise<readonly RawAspsp[]>;
  readonly startAuth: (request: AuthRequest) => Promise<RawStartedAuthorization>;
  /** The code exchange. Enable Banking reveals the session id here and nowhere else. */
  readonly authorizeSession: (code: string) => Promise<RawAuthorizedSession>;
  readonly getSession: (sessionId: string) => Promise<RawSession>;
  /** An account as its bank describes it now; a call to the bank, not just to Enable Banking. */
  readonly accountDetails: (accountUid: string) => Promise<RawAccount>;
  /** Walks continuation keys; one call here may be several over the wire. */
  readonly getTransactions: (query: TransactionQuery) => Promise<readonly RawTransaction[]>;
  /** The balances the bank reports for one account; a call to the bank, one of its daily reads. */
  readonly getBalances: (accountUid: string) => Promise<readonly RawBalance[]>;
  /** Ends a session at Enable Banking, and with it the bank's consent. */
  readonly deleteSession: (sessionId: string) => Promise<void>;
};

export type Saved = {
  /** Where the file as it was before this write was copied, when there was one. */
  readonly backup?: string | undefined;
  /** What the label held before, when it held a readable consent. */
  readonly replaced?: StoredSession | undefined;
};

/**
 * sessions.json (domain/sessionsFile.ts), which other programs may read.
 *
 * `save` stores one entry under a label, copies the previous file aside first,
 * and leaves every other label exactly as it was.
 */
export type SessionStorePort = {
  readonly read: () => Promise<SessionBook>;
  readonly save: (label: string, entry: SessionEntry) => Promise<Saved>;
  /** Drops one label, copying the file aside first; `replaced` is what it held, absent when the label was not there. */
  readonly remove: (label: string) => Promise<Saved>;
};

export type Written = { readonly path: string; readonly sha256: string; readonly size: number };

/** Files this server hands back (an export), written whole, never world-readable. */
export type FilePort = {
  readonly writeText: (dir: string, name: string, text: string) => Promise<Written>;
};

export type Paths = {
  /** app.json; undefined when ENABLE_BANKING_CONFIG is not set. */
  readonly config: string | undefined;
  /** The private key when ENABLE_BANKING_KEY names it; otherwise app.json's `private_key` decides. */
  readonly keyOverride?: string | undefined;
  readonly stateDir: string;
  readonly sessions: string;
  readonly backup: string;
  /** Where export_transactions writes its CSV files. */
  readonly exportsDir: string;
};

/** The non-secret half of app.json, for the tools that report on configuration. */
export type AppIdentity = {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly environment: string;
  readonly redirectUrl: string;
  readonly privateKeyPath: string;
};

/** Seconds since the epoch. */
export type Clock = () => number;

export type Deps = {
  readonly bank: EnableBankingPort;
  readonly sessions: SessionStorePort;
  readonly files: FilePort;
  readonly paths: Paths;
  readonly identity: () => Promise<AppIdentity>;
  readonly now: Clock;
};
