import { storedFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { configError, fail } from "../../domain/errors.js";
import { fromStored, type StoredSession, toStored } from "../../domain/session.js";

const stored = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  obtained_at_epoch: z.number(),
  obtained_at: z.string().optional(),
  access_exp_epoch: z.number(),
  refresh_exp_epoch: z.number().nullable().optional(),
}) satisfies z.ZodType<StoredSession>;

/**
 * session.json: the whole session in one file; the lock is the caller's
 * (grant.ts). A corrupt file is a config failure (someone edited it), not a
 * missing session.
 */
export const makeSessionFile = (path: string) =>
  storedFile(path, {
    schema: stored,
    fromDisk: fromStored,
    toDisk: toStored,
    corrupt: (issues) => fail(configError(`the session at ${path} lacks or mistypes: ${issues}; delete it and sign in again`)),
  });
