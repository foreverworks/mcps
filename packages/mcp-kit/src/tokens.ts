import { rm } from "node:fs/promises";
import { join } from "node:path";

import { readJsonFile, withFileLock, writeJsonFile } from "./jsonFile.js";

/**
 * Access tokens: minted on demand, kept in memory, persisted so a restart does
 * not mint again, and minted ONCE when many callers need one at the same time.
 *
 * How a token is minted is each server's (a refresh-token grant, client
 * credentials, a rotating refresh token that must itself be saved); that
 * arrives as `mint`. The rest is identical everywhere and lives here.
 */

export type Minted = {
  readonly token: string;
  readonly expiresAtEpoch: number;
  /** What the issuer said the token grants, when it says. */
  readonly scope?: string;
};

export type TokenStore = {
  readonly read: () => Promise<Minted | undefined>;
  readonly write: (minted: Minted) => Promise<void>;
  /** Serialises minting across PROCESSES (the service and a CLI run of the same server). */
  readonly withLock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Drop what is persisted, when the grant behind it was replaced. A store that persists nothing need not have it. */
  readonly clear?: () => Promise<void>;
};

/**
 * `<stateDir>/<name>.json`, 0600, written atomically, with a sidecar lock whose
 * stale deadline keeps a process killed mid-mint from wedging the rest. One
 * file per GRANT, never per account: two grants of one account sharing a file
 * would hand a read-only token to a write.
 */
export const fileTokenStore = (stateDir: string, name = "access_token"): TokenStore => {
  const file = join(stateDir, `${name}.json`);
  return {
    read: async () => {
      const raw = await readJsonFile<Partial<Minted>>(file);
      // An entry missing either half is not half-usable.
      return typeof raw?.token === "string" && typeof raw.expiresAtEpoch === "number"
        ? { token: raw.token, expiresAtEpoch: raw.expiresAtEpoch, ...(typeof raw.scope === "string" ? { scope: raw.scope } : {}) }
        : undefined;
    },
    write: (minted) => writeJsonFile(file, minted, { pretty: false }),
    withLock: (fn) => withFileLock(stateDir, `${name}.lock`, fn, { minTimeoutMs: 50, maxTimeoutMs: 500 }),
    clear: () => rm(file, { force: true }),
  };
};

/** Nothing persisted: a token lives as long as the process (tests, short-lived grants). */
export const memoryTokenStore = (): TokenStore => {
  const held: { minted?: Minted } = {};
  return {
    read: async () => held.minted,
    write: async (minted) => {
      held.minted = minted;
    },
    withLock: (fn) => fn(),
    clear: async () => {
      delete held.minted;
    },
  };
};

export type TokenSource = {
  readonly get: () => Promise<string>;
  /** A new token now: the cached one was refused (revoked before its stated expiry). */
  readonly force: () => Promise<string>;
  /** The whole entry, for a caller that needs the scope. */
  readonly current: () => Promise<Minted>;
  /**
   * Mint now whatever the cache holds, under the lock: a scheduled refresh of a
   * grant whose refresh token rotates (ANAF), where waiting for expiry would
   * let the refresh token itself lapse.
   */
  readonly rotate: () => Promise<Minted>;
  /**
   * Hold nothing: the grant behind the tokens was replaced (a re-consent), so
   * neither the token in memory nor the stored one may be handed out again.
   * The next call mints from the grant as it is now.
   */
  readonly forget: () => Promise<void>;
};

export type TokenSourceOptions = {
  readonly mint: () => Promise<Minted>;
  readonly store: TokenStore;
  /** Mint this many seconds before the stated expiry. */
  readonly skewSeconds?: number;
  readonly nowEpoch?: () => number;
};

/** Seconds since the epoch, the unit every token expiry here is kept in. */
export const epochNow = (): number => Math.floor(Date.now() / 1000);

export const makeTokenSource = ({ mint, store, skewSeconds = 60, nowEpoch = epochNow }: TokenSourceOptions): TokenSource => {
  const fresh = (m: Minted | undefined): m is Minted => m !== undefined && m.token !== "" && m.expiresAtEpoch - nowEpoch() > skewSeconds;
  // Closure state: the token in hand, and the one mint in flight that every concurrent caller shares.
  const held: { minted?: Minted | undefined; minting?: Promise<Minted> | undefined } = {};

  /** `discard`: a token not to accept back from the store; `always`: mint even if the store is fresh. */
  const mintOnce = (discard: string | undefined, always = false): Promise<Minted> => {
    held.minting ??= store
      .withLock(async () => {
        // Another process may have minted while this one waited for the lock, unless that is the
        // very token being discarded.
        const stored = await store.read();
        if (!always && fresh(stored) && stored.token !== discard) return stored;
        const minted = await mint();
        await store.write(minted);
        return minted;
      })
      .then((minted) => {
        held.minted = minted;
        return minted;
      })
      .finally(() => {
        held.minting = undefined;
      });
    return held.minting;
  };

  const current = async (): Promise<Minted> => {
    if (fresh(held.minted)) return held.minted;
    const stored = await store.read();
    if (fresh(stored)) {
      held.minted = stored;
      return stored;
    }
    return mintOnce(undefined);
  };

  return {
    get: async () => (await current()).token,
    force: async () => {
      const refused = held.minted?.token;
      held.minted = undefined;
      return (await mintOnce(refused)).token;
    },
    current,
    rotate: () => mintOnce(undefined, true),
    forget: async () => {
      held.minted = undefined;
      await store.clear?.();
    },
  };
};
