import { jsonObject, jwtClaims } from "@foreverworks/receipts/domain";

/**
 * What a Glovo refresh JWT says about itself, read without verifying it
 * (packages/receipts, token.ts). The claim set is
 * `{iat, iss: "auth", role: "REFRESH", version, jti, payload}` where `payload`
 * is itself a JSON STRING holding `{userId, deviceId, grantType}`. There is no
 * `exp`: the token states no lifetime, so this cannot count days left the way
 * bolt-food does, and does not pretend to.
 */
export type TokenFacts = { readonly userId?: number };

export const readTokenFacts = (jwt: string): TokenFacts | undefined => {
  const claims = jwtClaims(jwt);
  if (claims === undefined) return undefined;
  const inner = claims["payload"];
  const payload = typeof inner === "string" ? jsonObject(inner) : (inner as { readonly userId?: unknown } | null | undefined);
  const userId = payload?.["userId"];
  return typeof userId === "number" ? { userId } : {};
};
