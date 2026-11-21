import { dirname } from "node:path";

import type { Granted } from "./oauth.js";
import type { StoredFile } from "./storedFile.js";
import { withFileLock } from "./jsonFile.js";
import { epochNow } from "./tokens.js";

/**
 * A grant whose refresh token ROTATES: every refresh returns a new refresh
 * token and the old one stops working. Two rules make that safe, and both
 * live here so no server gets them wrong:
 *
 * - The new pair is written (temp file and rename, by the stored file) BEFORE
 *   the access token is handed to anyone. A crash after the exchange then
 *   loses nothing; a write that fails fails the refresh.
 * - One refresh at a time. Callers in this process share the one in flight,
 *   and a lock on the state directory serialises other processes, which
 *   read the file again under the lock and use what a rival just wrote
 *   instead of spending the same refresh token twice.
 */
export type RotatingGrant = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAtEpoch: number;
  readonly scope?: string;
};

export type RotatingGrantOptions = {
  readonly store: StoredFile<RotatingGrant>;
  /** The state file's path, which names the directory the lock lives in. */
  readonly path: string;
  readonly lockName: string;
  /** The refresh-token exchange; the server's own failure when the provider refuses. */
  readonly refresh: (refreshToken: string) => Promise<Granted>;
  /** The server's failure for "there is no grant". Must throw. */
  readonly missing: () => never;
  /** Refresh this many seconds before the stated expiry. */
  readonly skewSeconds?: number;
  readonly nowEpoch?: () => number;
};

export type GrantSource = {
  /** An access token good for the skew, refreshed first when it is not. */
  readonly get: () => Promise<string>;
  /** A new one now: the upstream refused the one in hand. */
  readonly force: () => Promise<string>;
};

/** The grant after a refresh: the new pair, or the new access token with the old refresh token when the provider did not rotate. */
export const grantAfterRefresh = (previous: RotatingGrant, granted: Granted, nowEpoch: number): RotatingGrant => ({
  accessToken: granted.accessToken,
  refreshToken: granted.refreshToken ?? previous.refreshToken,
  expiresAtEpoch: nowEpoch + granted.expiresInSeconds,
  ...(granted.scope === undefined ? previous.scope === undefined ? {} : { scope: previous.scope } : { scope: granted.scope }),
});

export const makeGrantSource = ({ store, path, lockName, refresh, missing, skewSeconds = 60, nowEpoch = epochNow }: RotatingGrantOptions): GrantSource => {
  const fresh = (grant: RotatingGrant | undefined): grant is RotatingGrant => grant !== undefined && grant.expiresAtEpoch - nowEpoch() > skewSeconds;
  const state: { inflight?: Promise<string> | undefined } = {};

  const renew = (discard: string | undefined): Promise<string> => {
    state.inflight ??= withFileLock(dirname(path), lockName, async () => {
      const stored = await store.read();
      if (stored === undefined) return missing();
      // A rival process may have refreshed while this one waited for the lock.
      if (fresh(stored) && stored.accessToken !== discard) return stored.accessToken;
      const next = grantAfterRefresh(stored, await refresh(stored.refreshToken), nowEpoch());
      await store.write(next);
      return next.accessToken;
    }).finally(() => {
      state.inflight = undefined;
    });
    return state.inflight;
  };

  return {
    get: async () => {
      const stored = await store.read();
      if (stored === undefined) return missing();
      return fresh(stored) ? stored.accessToken : renew(undefined);
    },
    force: async () => renew((await store.read())?.accessToken),
  };
};
