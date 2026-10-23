import { createHash, randomBytes } from "node:crypto";

import { makeErrorKit } from "./errors.js";
import { makeHttp, type HttpAuth, type HttpFailure, type Sleep } from "./http.js";
import type { Minted } from "./tokens.js";

/**
 * OAuth 2.0 token endpoints (RFC 6749), the first specialisation of the kit's
 * HTTP client: the three grants the servers here use, and bearer auth for the
 * requests that follow. What a grant MEANS (which remedy a refused one gets, a
 * refresh token that rotates and must be saved) stays with each server.
 *
 *   makeHttp -> makeOAuthClient -> makeTokenSource (tokens.ts) -> bearer -> an API's policy
 */

/** Why a token endpoint call failed; each server turns it into its own failure. */
export type OAuthFailure =
  /** The endpoint answered and said no: `error` is RFC 6749's code (invalid_grant: re-consent). */
  | { readonly kind: "grant_refused"; readonly status: number; readonly error: string; readonly description: string }
  | { readonly kind: "unreachable"; readonly message: string };

/** What an endpoint granted. `refreshToken` is present when it issued (or rotated) one. */
export type Granted = {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly scope?: string;
  readonly refreshToken?: string;
  /** The endpoint's whole answer, for the fields an API adds (ANAF's refresh expiry). */
  readonly raw: Readonly<Record<string, unknown>>;
};

export type OAuthClientOptions = {
  readonly tokenUri: string;
  readonly clientId: string;
  /** Absent for a public client (RFC 6749 2.1: a browser app, a native app): it sends client_id alone. */
  readonly clientSecret?: string;
  /** Send the client as HTTP Basic rather than in the form (RFC 6749 2.3.1 allows both; some endpoints demand one). A public client has no secret to send this way. */
  readonly clientAuth?: "form" | "basic";
  /** The server's own tagged failure. Must throw. */
  readonly fail: (failure: OAuthFailure) => never;
  readonly timeoutMs?: number;
  /** Sent with every grant, for an endpoint that wants more than RFC 6749 (ANAF: token_content_type=jwt). */
  readonly extraForm?: Readonly<Record<string, string>>;
  /** Seconds assumed when the endpoint omits expires_in. */
  readonly defaultExpiresIn?: number;
  readonly sleep?: Sleep;
  readonly fetch?: typeof fetch;
};

export type OAuthClient = {
  readonly refresh: (refreshToken: string, scope?: string) => Promise<Granted>;
  readonly clientCredentials: (scope?: string) => Promise<Granted>;
  readonly authorizationCode: (code: string, redirectUri: string, codeVerifier?: string) => Promise<Granted>;
};

const internal = makeErrorKit<HttpFailure>("mcp-kit.oauth.http");

export const makeOAuthClient = (options: OAuthClientOptions): OAuthClient => {
  const { tokenUri, clientId, clientSecret, clientAuth = "form", fail, timeoutMs = 15_000, defaultExpiresIn = 3600, extraForm = {} } = options;
  const http = makeHttp({
    service: "token endpoint",
    // A grant request mints a token and changes nothing else, so resending it is harmless.
    isRetryable: (status) => status >= 500,
    fail: internal.fail,
    attempts: 3,
    timeoutMs,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const grant = async (form: Readonly<Record<string, string>>): Promise<Granted> => {
    const client = clientAuth === "basic" ? {} : { client_id: clientId, ...(clientSecret === undefined ? {} : { client_secret: clientSecret }) };
    const headers = clientAuth === "basic" ? { Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret ?? "")}`).toString("base64")}` } : {};
    const raw = await http<Record<string, unknown>>(tokenUri, { method: "POST", idempotent: true, form: { ...form, ...extraForm, ...client }, headers }).catch((thrown: unknown) => {
      const failure = internal.asAppError(thrown);
      if (failure === undefined) throw thrown;
      if (failure.kind === "rejected") {
        const body = (typeof failure.body === "object" && failure.body !== null ? failure.body : {}) as { error?: unknown; error_description?: unknown };
        return fail({
          kind: "grant_refused",
          status: failure.status,
          error: typeof body.error === "string" ? body.error : `http_${failure.status}`,
          description: typeof body.error_description === "string" ? body.error_description : failure.message,
        });
      }
      return fail({ kind: "unreachable", message: failure.message });
    });
    const accessToken = raw["access_token"];
    if (typeof accessToken !== "string" || accessToken === "") {
      return fail({ kind: "grant_refused", status: 200, error: "no_access_token", description: "the token endpoint answered without an access token" });
    }
    const expiresIn = Number(raw["expires_in"]);
    return {
      accessToken,
      expiresInSeconds: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : defaultExpiresIn,
      ...(typeof raw["scope"] === "string" ? { scope: raw["scope"] } : {}),
      ...(typeof raw["refresh_token"] === "string" && raw["refresh_token"] !== "" ? { refreshToken: raw["refresh_token"] } : {}),
      raw,
    };
  };

  return {
    refresh: (refreshToken, scope) => grant({ grant_type: "refresh_token", refresh_token: refreshToken, ...(scope ? { scope } : {}) }),
    clientCredentials: (scope) => grant({ grant_type: "client_credentials", ...(scope ? { scope } : {}) }),
    authorizationCode: (code, redirectUri, codeVerifier) =>
      grant({ grant_type: "authorization_code", code, redirect_uri: redirectUri, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) }),
  };
};

/** A grant as the entry a token source keeps. */
export const mintedFrom = (granted: Granted, nowEpoch: number): Minted => ({
  token: granted.accessToken,
  expiresAtEpoch: nowEpoch + granted.expiresInSeconds,
  ...(granted.scope ? { scope: granted.scope } : {}),
});

/** What a request needs from a token source: one now, and a fresh one after a 401. */
export type BearerTokens = { readonly get: () => Promise<string>; readonly force: () => Promise<unknown> };

/** Bearer auth from a token source: the header, and one forced refresh after a 401. */
export const bearer = (tokens: BearerTokens): HttpAuth => ({
  headers: async () => ({ Authorization: `Bearer ${await tokens.get()}` }),
  renew: tokens.force,
});

/*
 * The authorization-code flow's pure parts (RFC 6749 4.1 with PKCE, RFC 7636):
 * the verifier and its challenge, the state, the URL the owner opens, and the
 * redirect it lands on, read back. The exchange is `authorizationCode` above.
 * `random` is injectable so a test can pin every byte.
 */

export type Random = (bytes: number) => Uint8Array;

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** RFC 7636: the code verifier and its S256 challenge. */
export type Pkce = { readonly verifier: string; readonly challenge: string; readonly method: "S256" };

/** The challenge for a verifier: BASE64URL(SHA256(verifier)), no padding (RFC 7636 4.2). */
export const pkceFrom = (verifier: string): Pkce => ({
  verifier,
  challenge: base64url(createHash("sha256").update(verifier, "ascii").digest()),
  method: "S256",
});

/** A fresh verifier: 32 random bytes, 43 base64url characters, inside RFC 7636's 43 to 128. */
export const newPkce = (random: Random = randomBytes): Pkce => pkceFrom(base64url(random(32)));

/** The `state` that ties a redirect to the request that caused it: 16 random bytes, base64url. */
export const newState = (random: Random = randomBytes): string => base64url(random(16));

export type AuthorizeRequest = {
  readonly authUri: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly state: string;
  readonly pkce: Pkce;
  /** What a provider adds to the standard: Google's access_type=offline, prompt=consent, login_hint. */
  readonly extra?: Readonly<Record<string, string>>;
};

/** The URL the user opens to grant access. The standard parameters win over an `extra` of the same name. */
export const authorizeUrl = (request: AuthorizeRequest): string => {
  const url = new URL(request.authUri);
  const params: Readonly<Record<string, string>> = {
    ...request.extra,
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    scope: request.scopes.join(" "),
    state: request.state,
    code_challenge: request.pkce.challenge,
    code_challenge_method: request.pkce.method,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

/** Where an authorization ended, read from the URL the browser was redirected to. */
export type Redirect =
  | { readonly kind: "code"; readonly code: string; readonly state: string }
  /** The provider said no (access_denied when the owner cancelled), with its description when it gave one. */
  | { readonly kind: "refused"; readonly error: string; readonly description?: string; readonly state?: string }
  /** Not a redirect from an authorization at all: unparseable, or no code and no error. */
  | { readonly kind: "invalid"; readonly message: string };

export const parseRedirect = (redirect: string): Redirect => {
  let url: URL;
  try {
    url = new URL(redirect.trim());
  } catch {
    return { kind: "invalid", message: "not a URL" };
  }
  const q = url.searchParams;
  const state = q.get("state") ?? undefined;
  const error = q.get("error");
  if (error) {
    const description = q.get("error_description") ?? undefined;
    return { kind: "refused", error, ...(description ? { description } : {}), ...(state ? { state } : {}) };
  }
  const code = q.get("code");
  if (!code) return { kind: "invalid", message: "the URL carries neither a code nor an error" };
  if (!state) return { kind: "invalid", message: "the URL carries a code but no state" };
  return { kind: "code", code, state };
};
