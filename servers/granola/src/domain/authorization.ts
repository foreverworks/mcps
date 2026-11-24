import type { OAuthEndpoints, PendingPkceAuthorization } from "@foreverworks/mcp-kit";

import { authorizationError, fail } from "./errors.js";

/** How long a begun sign-in stays open: a person opening a link and signing in, with room to spare. */
export const AUTHORIZATION_TTL_S = 600;

/**
 * The scopes to ask for: what Granola's MCP server names (`mcp`), and always
 * offline_access, which is what makes Granola return a refresh token; without
 * one the grant would end within the hour. A deployment's own list wins.
 */
export const scopeFor = (endpoints: Pick<OAuthEndpoints, "resourceScopes">, override: string | undefined): string => {
  if (override !== undefined && override.trim() !== "") return override.trim().split(/\s+/).join(" ");
  const wanted = endpoints.resourceScopes.length > 0 ? [...endpoints.resourceScopes] : ["mcp"];
  if (!wanted.includes("offline_access")) wanted.push("offline_access");
  return wanted.join(" ");
};

/** The begun sign-in a returning address belongs to, or the failure that says why not. */
export const matchPending = (pending: PendingPkceAuthorization | undefined, state: string | undefined, nowEpoch: number): PendingPkceAuthorization => {
  if (pending === undefined) return fail(authorizationError("no sign-in is open: call begin_authorization first"));
  if (nowEpoch - pending.createdAtEpoch > AUTHORIZATION_TTL_S) return fail(authorizationError("the sign-in was begun more than ten minutes ago and has closed"));
  if (state !== undefined && state !== pending.state) return fail(authorizationError("that address belongs to another sign-in (its state does not match the one begun last)"));
  return pending;
};

/** The page the browser landed on is the redirect address the sign-in began with: same origin and path, whatever follows. */
export const landedOnRedirect = (redirectUri: string, landed: string): boolean => {
  try {
    const a = new URL(redirectUri);
    const b = new URL(landed.trim());
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
};

/** RFC 9207: when the returning address names the issuer that answered (`iss`), it must be the one this sign-in began with. */
export const issuerMatches = (issuer: string, landed: string): boolean => {
  try {
    const named = new URL(landed.trim()).searchParams.get("iss");
    return named === null || named.replace(/\/$/, "") === issuer.replace(/\/$/, "");
  } catch {
    return false;
  }
};

export const isoOf = (epoch: number): string => new Date(epoch * 1000).toISOString();
