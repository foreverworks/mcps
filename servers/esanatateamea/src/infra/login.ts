import { join } from "node:path";

import { authorizeUrl, liveFetch, type OAuthClient, pendingPkceAuthorizationFile, pkceFrom, storedFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { LoginPort } from "../app/ports.js";
import { fail, loginRefused } from "../domain/errors.js";
import type { PendingCode } from "../domain/login.js";
import { type AppConfig, endpoints } from "./config.js";
import { issuedOf } from "./oauthClient.js";
import { makePasswordForm } from "./signIn/form.js";

/**
 * Signing in at Keycloak: its authorize URL (with `response_mode=query`, so
 * the code lands in the query string of a static file and can be read off
 * the address bar; with `kc_idp_hint=roeid` for ROeID), the password form
 * (signIn/form.ts), the code exchange through the same OAuth client the
 * refresh uses, the end-session call, and the two kinds of begun login in the
 * state dir: `login.json` (a ROeID login's PKCE verifier) and `code.json` (a
 * password sign-in waiting for its code, with Keycloak's cookies for it).
 * Both are written 0600 and dropped once used.
 */
const cookieOnDisk = z.object({ name: z.string(), value: z.string(), domain: z.string(), hostOnly: z.boolean(), path: z.string() });

const pendingCodeOnDisk = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  redirect_uri: z.string().min(1),
  created_at_epoch: z.number(),
  action: z.string().min(1),
  cookies: z.array(cookieOnDisk),
});

const pendingCodeFile = (stateDir: string) =>
  storedFile(join(stateDir, "code.json"), {
    schema: pendingCodeOnDisk,
    fromDisk: (d): PendingCode => ({ state: d.state, verifier: d.verifier, redirectUri: d.redirect_uri, createdAtEpoch: d.created_at_epoch, action: d.action, cookies: d.cookies }),
    toDisk: (p) => ({ state: p.state, verifier: p.verifier, redirect_uri: p.redirectUri, created_at_epoch: p.createdAtEpoch, action: p.action, cookies: [...p.cookies] }),
  });

export const makeLogin = (options: { readonly config: AppConfig; readonly client: OAuthClient; readonly fetch?: typeof fetch }): LoginPort => {
  const { config, client } = options;
  const doFetch = options.fetch ?? liveFetch;
  const urls = endpoints(config.issuer);
  const form = makePasswordForm({ fetch: doFetch, redirectUri: config.redirectUri });
  const authorize = (state: string, pkce: { readonly challenge: string; readonly method: "S256" }, idp?: string): string =>
    authorizeUrl({
      authUri: urls.authorize,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      state,
      pkce: { verifier: "", challenge: pkce.challenge, method: pkce.method },
      extra: { response_mode: "query", ...(idp === undefined ? {} : { kc_idp_hint: idp }) },
    });
  /** A code from the form must answer the state this sign-in sent; anything else is not ours to spend. */
  const ours = (state: string | undefined, expected: string, code: string): string =>
    state === expected ? code : fail(loginRefused("Keycloak ended the sign-in with a state this server did not send"));
  return {
    redirectUri: config.redirectUri,
    authorizeUrl: authorize,
    exchangeCode: async (code, redirectUri, verifier) => issuedOf(await client.authorizationCode(code, redirectUri, verifier)),
    passwordForm: async (begun, credentials) => {
      const step = await form.start(authorize(begun.state, pkceFrom(begun.verifier)), credentials);
      if (step.kind === "code") return { kind: "code", code: ours(step.state, begun.state, step.code) };
      return { kind: "needs_code", pending: { ...begun, action: step.action, cookies: step.cookies } };
    },
    submitCode: async (pending, otp) => {
      const step = await form.submitCode(pending, otp);
      return step.kind === "code" ? ours(step.state, pending.state, step.code) : fail(loginRefused("Keycloak asked for the authenticator code again"));
    },
    // Keycloak ends the session the refresh token belongs to. A refusal (the token already
    // dead) is the outcome wanted, so nothing is thrown.
    endSession: async (refreshToken) => {
      try {
        await doFetch(urls.logout, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: config.clientId, refresh_token: refreshToken }).toString(),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // unreachable: the local session is forgotten either way
      }
    },
    pending: pendingPkceAuthorizationFile(config.stateDir, "login"),
    pendingCode: pendingCodeFile(config.stateDir),
  };
};
