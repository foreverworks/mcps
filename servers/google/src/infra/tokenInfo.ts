import { z } from "zod";

import { apiError, fail } from "../domain/errors.js";
import type { TokenInfo } from "../domain/tokenInfo.js";
import type { GetJson } from "./httpJson.js";

const TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";

const SHAPE = z.object({
  aud: z.string().optional(),
  scope: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.union([z.string(), z.boolean()]).transform(String).optional(),
  expires_in: z.union([z.string(), z.number()]).transform(String).optional(),
});

/**
 * Ask the ISSUER about an access token. A credentials file only declares what
 * it grants; this is what Google says. Gmail's health check asks it, and a
 * consent asks it who approved.
 */
export const makeTokenInfo =
  (getJson: GetJson) =>
  async (accessToken: string): Promise<TokenInfo> => {
    const parsed = SHAPE.safeParse(await getJson<unknown>(TOKENINFO, { access_token: accessToken }));
    if (!parsed.success) return fail(apiError(0, `tokeninfo answered in a shape this server does not know: ${parsed.error.message}`));
    const { data } = parsed;
    return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as TokenInfo;
  };
