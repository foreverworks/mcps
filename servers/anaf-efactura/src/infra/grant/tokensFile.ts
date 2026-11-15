import { storedFile } from "@foreverworks/mcp-kit";
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
 * tokens.json: the whole grant in one file, snake_case (domain/tokens.ts);
 * the lock is the caller's (grant.ts).
 */
export const makeTokensFile = (path: string) => {
  const file = storedFile(path, {
    schema: stored,
    fromDisk: fromStored,
    toDisk: toStored,
    corrupt: (issues) => fail(configError(`tokens at ${path} lack or mistype: ${issues}`)),
  });
  return {
    readOptional: file.read,
    // A missing token file and a corrupt one need the same human action.
    read: async (): Promise<TokenBundle> =>
      (await file.read()) ?? fail(configError(`tokens at ${path} are missing or unparseable; authorize with begin_authorization`)),
    write: file.write,
  } as const;
};
