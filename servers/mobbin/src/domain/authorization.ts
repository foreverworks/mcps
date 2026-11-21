import type { OAuthEndpoints, PendingPkceAuthorization } from "@foreverworks/mcp-kit";

import { authorizationError, fail } from "./errors.js";

/** How long a begun sign-in stays open: a person opening a link and signing in, with room to spare. */
export const AUTHORIZATION_TTL_S = 600;

/**
 * The scopes to ask for: what the resource names, and offline_access when the
 * authorization server offers it, which is what makes it return a refresh
 * token. A deployment's own list wins.
 */
export const scopeFor = (endpoints: Pick<OAuthEndpoints, "resourceScopes" | "serverScopes">, override: string | undefined): string => {
  if (override !== undefined && override.trim() !== "") return override.trim().split(/\s+/).join(" ");
  const wanted = endpoints.resourceScopes.length > 0 ? [...endpoints.resourceScopes] : ["openid"];
  if (endpoints.serverScopes.includes("offline_access") && !wanted.includes("offline_access")) wanted.push("offline_access");
  return wanted.join(" ");
};

/** The begun sign-in a returning address belongs to, or the failure that says why not. */
export const matchPending = (pending: PendingPkceAuthorization | undefined, state: string | undefined, nowEpoch: number): PendingPkceAuthorization => {
  if (pending === undefined) return fail(authorizationError("no sign-in is open: call begin_authorization first"));
  if (nowEpoch - pending.createdAtEpoch > AUTHORIZATION_TTL_S) return fail(authorizationError("the sign-in was begun more than ten minutes ago and has closed"));
  if (state !== undefined && state !== pending.state) return fail(authorizationError("that address belongs to another sign-in (its state does not match the one begun last)"));
  return pending;
};

export const isoOf = (epoch: number): string => new Date(epoch * 1000).toISOString();
