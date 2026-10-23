import { z } from "zod";

import type { AccessTokenClaims } from "../../domain/schema.js";

const loose = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const claims = z
  .object({ exp: loose(z.number()), serial: loose(z.string()), issuer: loose(z.string()), roles: loose(z.string()) })
  .catch({}) satisfies z.ZodType<AccessTokenClaims>;

/**
 * The access token's own claims (domain/schema.ts), read WITHOUT verifying the
 * signature: nothing here is trusted for authorization, only reported (roles,
 * certificate serial) or used as the expiry, where the token's own `exp` beats
 * a computed one. A token that is not a JWT, or a claim of the wrong type, is
 * simply absent.
 */
export const claimsOf = (token: string): AccessTokenClaims => {
  const payload = token.split(".")[1];
  try {
    return claims.parse(payload === undefined ? {} : JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return {};
  }
};
