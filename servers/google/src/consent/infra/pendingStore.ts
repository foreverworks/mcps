import { join } from "node:path";

import { readJsonFile, withFileLock, writeJsonFile } from "@foreverworks/mcp-kit";

import type { PendingStore } from "../app/ports.js";
import { isLive, type Pending } from "../domain/consent.js";

const FILE = "consent-pending.json";

/**
 * The consents waiting for their redirect, in ONE file in the service's state
 * dir (0600: it holds PKCE verifiers and the client secret they were asked
 * on), keyed by state. Every write drops what has expired, and a take removes
 * the one it returns, under a lock, so a consent completes at most once even
 * with two sessions racing to complete it.
 */
export const makePendingStore = (stateDir: string): PendingStore => {
  const file = join(stateDir, FILE);
  const update = <T>(change: (all: readonly Pending[]) => { readonly keep: readonly Pending[]; readonly result: T }): Promise<T> =>
    withFileLock(stateDir, `${FILE}.lock`, async () => {
      const all = (await readJsonFile<{ readonly pending?: readonly Pending[] }>(file))?.pending ?? [];
      const { keep, result } = change(all);
      await writeJsonFile(file, { pending: keep }, { mode: 0o600 });
      return result;
    });

  return {
    put: (pending) => update((all) => ({ keep: [...all.filter((p) => isLive(p, pending.createdAt)), pending], result: undefined })),
    take: (state, now) =>
      update((all) => {
        const found = all.find((p) => p.state === state);
        return { keep: all.filter((p) => p !== found && isLive(p, now)), result: found && isLive(found, now) ? found : undefined };
      }),
  };
};
