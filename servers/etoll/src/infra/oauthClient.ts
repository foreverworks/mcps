import { type Granted, makeOAuthClient, type OAuthClient, type OAuthFailure } from "@foreverworks/mcp-kit";

import { type AppError, asAppError, fail } from "../domain/errors.js";
import type { Issued } from "../domain/session.js";
import { endpoints } from "./config.js";

/**
 * Keycloak's token endpoint through the kit's OAuth client: a public client
 * (no secret), with refresh, the code exchange of a browser sign-in, and the
 * password grant.
 *
 * `invalid_grant` on a refresh is Keycloak's one word for "that session is
 * over": its description tells an idle session that lapsed ("Session not
 * active", "Token is not active") from a revoked or replaced token. Both are
 * `needs_login`; the reason is kept so session_status can say which.
 */
const failureFor = (failure: OAuthFailure): AppError => {
  if (failure.kind === "unreachable") return { kind: "api", status: 0, message: failure.message };
  if (failure.error === "invalid_grant") {
    const lapsed = /not active|expired/i.test(failure.description);
    return { kind: "needs_login", reason: lapsed ? "expired" : "revoked", message: `Keycloak: ${failure.description}` };
  }
  if (failure.status >= 500) return { kind: "api", status: failure.status, message: `Keycloak: ${failure.error}: ${failure.description}` };
  return { kind: "input", message: `Keycloak refused the grant: ${failure.error}: ${failure.description}` };
};

export const makeKeycloakClient = (options: { readonly issuer: string; readonly clientId: string; readonly fetch?: typeof fetch }): OAuthClient =>
  makeOAuthClient({
    tokenUri: endpoints(options.issuer).token,
    clientId: options.clientId,
    fail: (failure) => fail(failureFor(failure)),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

/**
 * A password sign-in. Any refusal (`invalid_grant`: "Invalid user
 * credentials", "Account disabled", "Account is not fully set up"; or a client
 * that no longer takes passwords) is `login_refused`, never `needs_login`: the
 * same password must not be sent again until someone changes it.
 */
export const signInWithPassword = async (client: OAuthClient, username: string, password: string, scopes: readonly string[]): Promise<Granted> =>
  client.password(username, password, scopes.join(" ")).catch((thrown: unknown) => {
    const failure = asAppError(thrown);
    if (failure?.kind === "needs_login" || failure?.kind === "input") return fail({ kind: "login_refused", message: failure.message.replace(/^Keycloak refused the grant: /, "Keycloak: ") });
    throw thrown;
  });

/** What a Keycloak answer amounts to: the kit's fields plus `refresh_expires_in`, which only Keycloak states. */
export const issuedOf = (granted: Granted): Issued => {
  const refreshExpiresIn = Number(granted.raw["refresh_expires_in"]);
  const tokenType = granted.raw["token_type"];
  return {
    accessToken: granted.accessToken,
    refreshToken: granted.refreshToken,
    expiresIn: granted.expiresInSeconds,
    refreshExpiresIn: Number.isFinite(refreshExpiresIn) ? refreshExpiresIn : undefined,
    scope: granted.scope,
    tokenType: typeof tokenType === "string" ? tokenType : undefined,
  };
};
