import { jwtClaims } from "@foreverworks/receipts/domain";

/**
 * What a Bolt refresh JWT says about itself: whose account (`data.user_id`)
 * and when it expires (`exp`), read without verifying it (packages/receipts,
 * token.ts).
 */
export type TokenFacts = {
  readonly userId?: number;
  readonly expiresAt?: number;
};

export const readTokenFacts = (jwt: string): TokenFacts | undefined => {
  const claims = jwtClaims(jwt);
  if (claims === undefined) return undefined;
  const userId = (claims["data"] as { readonly user_id?: unknown } | null | undefined)?.user_id;
  const expiresAt = claims["exp"];
  return {
    ...(typeof userId === "number" ? { userId } : {}),
    ...(typeof expiresAt === "number" ? { expiresAt } : {}),
  };
};

/**
 * The refresh token lasts about a year and nothing renews it (rotating it would
 * sign the user out of every device). Two weeks is enough notice to re-extract
 * it by hand before the server goes dark.
 */
export const EXPIRY_WARNING_DAYS = 14;

export const daysLeft = (facts: TokenFacts, nowMs: number): number | undefined =>
  facts.expiresAt === undefined ? undefined : Math.floor((facts.expiresAt * 1000 - nowMs) / 86_400_000);
