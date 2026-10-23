import { rm } from "node:fs/promises";

import { readJsonFile, withFileLock, writeJsonFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { LoginPort } from "../../app/ports.js";
import type { PendingLogin } from "../../domain/login.js";

const onDisk = z.object({ state: z.string().min(1), verifier: z.string().min(1), redirect_uri: z.string().min(1), created_at_epoch: z.number() });

/**
 * The one begun login, `<state dir>/login.json` (0600: it holds the PKCE
 * verifier, which is what makes the code useless to anyone who reads the
 * address bar). A file rather than memory because the HTTP service is
 * stateless per request and may restart between the two calls. One at a
 * time: beginning again replaces it.
 */
export const makePendingStore = (path: string, stateDir: string): LoginPort["pending"] => {
  const locked = <T>(fn: () => Promise<T>): Promise<T> => withFileLock(stateDir, "login.lock", fn);
  return {
    read: async () => {
      const parsed = onDisk.safeParse(await readJsonFile<unknown>(path));
      return parsed.success
        ? { state: parsed.data.state, verifier: parsed.data.verifier, redirectUri: parsed.data.redirect_uri, createdAtEpoch: parsed.data.created_at_epoch }
        : undefined;
    },
    write: (p: PendingLogin) =>
      locked(() => writeJsonFile(path, { state: p.state, verifier: p.verifier, redirect_uri: p.redirectUri, created_at_epoch: p.createdAtEpoch })),
    clear: () => locked(() => rm(path, { force: true })),
  };
};
