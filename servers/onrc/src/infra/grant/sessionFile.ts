import { rm } from "node:fs/promises";

import { issuesText, readJsonFile, writeJsonFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { configError, fail } from "../../domain/errors.js";
import { fromStored, type Session, type StoredSession, toStored } from "../../domain/session.js";

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
 * session.json: the whole session in one file, written atomically at 0600 by
 * the kit's writeJsonFile; the lock is the caller's (grant.ts). A corrupt
 * file is a config failure (someone edited it), not a missing session.
 */
export const makeSessionFile = (path: string) => ({
  read: async (): Promise<Session | undefined> => {
    const raw = await readJsonFile<unknown>(path);
    if (raw === undefined) return undefined;
    const parsed = stored.safeParse(raw);
    if (!parsed.success) return fail(configError(`the session at ${path} lacks or mistypes: ${issuesText(parsed.error)}; delete it and sign in again`));
    return fromStored(parsed.data);
  },
  write: (session: Session): Promise<void> => writeJsonFile(path, toStored(session)),
  clear: (): Promise<void> => rm(path, { force: true }),
});
