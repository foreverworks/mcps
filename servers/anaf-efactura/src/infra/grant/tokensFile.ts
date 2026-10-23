import { issuesText, readJsonFile, writeJsonFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { configError, fail } from "../../domain/errors.js";
import { fromStored, type StoredTokens, toStored, type TokenBundle } from "../../domain/tokens.js";

const stored = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  obtained_at_epoch: z.number(),
  obtained_at: z.string().optional(),
  access_token_exp_epoch: z.number(),
  refresh_token_exp_epoch: z.number(),
  serial: z.string().nullable().optional(),
  issuer: z.string().nullable().optional(),
  roles: z.string().nullable().optional(),
}) satisfies z.ZodType<StoredTokens>;

/**
 * tokens.json: the whole grant in one file, snake_case (domain/tokens.ts).
 * Written atomically at 0600 by the kit's writeJsonFile; the lock is the
 * caller's (grant.ts).
 */
export const makeTokensFile = (path: string) => {
  const readOptional = async (): Promise<TokenBundle | undefined> => {
    const raw = await readJsonFile<unknown>(path);
    if (raw === undefined) return undefined;
    const parsed = stored.safeParse(raw);
    if (!parsed.success)
      return fail(configError(`tokens at ${path} lack or mistype: ${issuesText(parsed.error)}`));
    return fromStored(parsed.data);
  };
  return {
    readOptional,
    // A missing token file and a corrupt one need the same human action.
    read: async (): Promise<TokenBundle> =>
      (await readOptional()) ??
      fail(configError(`tokens at ${path} are missing or unparseable; authorize with begin_authorization`)),
    write: (bundle: TokenBundle): Promise<void> => writeJsonFile(path, toStored(bundle)),
  } as const;
};
