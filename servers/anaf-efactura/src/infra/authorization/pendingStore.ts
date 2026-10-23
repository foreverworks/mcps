import { rm } from "node:fs/promises";

import { readJsonFile, withFileLock, writeJsonFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { AuthorizationPort } from "../../app/ports.js";
import type { PendingAuthorization } from "../../domain/authorization.js";

const onDisk = z.object({ state: z.string().min(1), redirect_uri: z.string().min(1), created_at_epoch: z.number() });

/**
 * The one begun authorization, `<state dir>/authorization.json` (0600).
 *
 * A file rather than memory because the HTTP service is stateless per request
 * and may restart between the two calls. One at a time: beginning again
 * replaces it, which is what a person retrying from a fresh tab wants.
 */
export const makePendingStore = (path: string, stateDir: string): AuthorizationPort["pending"] => {
  const locked = <T>(fn: () => Promise<T>): Promise<T> => withFileLock(stateDir, "authorization.lock", fn);
  return {
    read: async () => {
      const parsed = onDisk.safeParse(await readJsonFile<unknown>(path));
      return parsed.success
        ? { state: parsed.data.state, redirectUri: parsed.data.redirect_uri, createdAtEpoch: parsed.data.created_at_epoch }
        : undefined;
    },
    write: (p: PendingAuthorization) =>
      locked(() => writeJsonFile(path, { state: p.state, redirect_uri: p.redirectUri, created_at_epoch: p.createdAtEpoch })),
    clear: () => locked(() => rm(path, { force: true })),
  };
};
