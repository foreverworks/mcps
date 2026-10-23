/**
 * The grant on the kit's token source, against a tokens.json in a temp dir and
 * a stubbed token endpoint. What is ANAF's: the rotated refresh token is saved
 * with the access token, the claims are read, an expired refresh token is not
 * spent, and the request carries HTTP Basic plus token_content_type=jwt.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { REFRESH_TOKEN_LIFETIME_S, toStored } from "../src/domain/tokens.js";
import { authorizeUrl, fromRedirect, makeAuthorization } from "../src/infra/authorization.js";
import { ANAF, type AppConfig } from "../src/infra/config.js";
import { makeGrant } from "../src/infra/grant.js";
import { anafOAuthClient } from "../src/infra/oauthClient.js";
import { bundle, DAY, errorOf, json, jwt, NOW, tempDir, withFetch } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

const config: AppConfig = {
  appName: "app",
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUris: ["https://example.test/cb"],
  cif: "92345672",
  endpoints: ANAF,
};

const setup = (stored = bundle()) => {
  const stateDir = tempDir("state");
  const tokensPath = join(stateDir, "tokens.json");
  writeFileSync(tokensPath, JSON.stringify(toStored(stored)));
  const grant = makeGrant({ tokensPath, stateDir, client: async () => anafOAuthClient(config), now: () => NOW });
  const onDisk = () => JSON.parse(readFileSync(tokensPath, "utf8")) as Record<string, unknown>;
  return { grant, tokensPath, stateDir, onDisk };
};

const granted = (over: Record<string, unknown> = {}) =>
  json({
    access_token: jwt({ exp: NOW + 90 * DAY, serial: "new-serial", issuer: "DigiSign", roles: "EFACTURA@ETRANSPORT" }),
    refresh_token: "new-refresh",
    expires_in: 7776000,
    token_type: "Bearer",
    scope: "clientappid issuer role serial",
    ...over,
  });

describe("the token endpoint request", () => {
  it("authenticates with HTTP Basic and asks for a JWT, on every grant", async () => {
    const spy = withFetch(async () => granted());
    await setup().grant.tokens.rotate();
    const init = spy.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("authorization")).toBe(`Basic ${Buffer.from("client-id:client-secret").toString("base64")}`);
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("old-refresh");
    expect(form.get("token_content_type")).toBe("jwt");
    expect(form.get("client_secret")).toBeNull();
  });
});

describe("rotate", () => {
  it("saves the rotated refresh token with the access token, at 0600, in the state dir", async () => {
    withFetch(async () => granted());
    const { grant, onDisk, tokensPath } = setup();
    const out = await grant.tokens.rotate();
    expect(onDisk()).toMatchObject({ refresh_token: "new-refresh", refresh_token_exp_epoch: NOW + REFRESH_TOKEN_LIFETIME_S });
    expect(out).toMatchObject({ refreshToken: "new-refresh", accessTokenExpEpoch: NOW + 90 * DAY });
    expect(statSync(tokensPath).mode & 0o777).toBe(0o600);
  });

  it("reads the certificate details out of the new access token", async () => {
    withFetch(async () => granted());
    expect(await setup().grant.tokens.rotate()).toMatchObject({ serial: "new-serial", issuer: "DigiSign", roles: "EFACTURA@ETRANSPORT" });
  });

  it("keeps the old refresh token and its expiry when an answer carries none", async () => {
    withFetch(async () => granted({ refresh_token: undefined }));
    const { grant, onDisk } = setup();
    await grant.tokens.rotate();
    expect(onDisk()).toMatchObject({ refresh_token: "old-refresh", refresh_token_exp_epoch: bundle().refreshTokenExpEpoch });
  });

  it("will not spend a refresh token past its expiry, and says a human must act", async () => {
    const spy = withFetch(async () => granted());
    const error = await errorOf(() => setup(bundle({ refreshTokenExpEpoch: NOW - 1 })).grant.tokens.rotate());
    expect(error).toMatchObject({ kind: "auth", code: "refresh_expired", permanent: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls invalid_grant permanent and leaves tokens.json as it was", async () => {
    withFetch(async () => json({ error: "invalid_grant", error_description: "expired" }, 400));
    const { grant, onDisk } = setup();
    const error = await errorOf(() => grant.tokens.rotate());
    expect(error).toMatchObject({ kind: "auth", code: "invalid_grant", permanent: true });
    expect(onDisk()).toMatchObject({ refresh_token: "old-refresh" });
  });
});

describe("access tokens for requests", () => {
  it("serves the stored token while it is fresh, without a call", async () => {
    const spy = withFetch(async () => granted());
    await expect(setup().grant.access.get()).resolves.toBe("old-access");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes on its own inside the three-day cushion", async () => {
    withFetch(async () => granted());
    const token = await setup(bundle({ accessTokenExpEpoch: NOW + DAY })).grant.access.get();
    expect(token).not.toBe("old-access");
  });

  it("is a config failure, naming the fix, when no grant was ever stored", async () => {
    const stateDir = tempDir("empty");
    const grant = makeGrant({ tokensPath: join(stateDir, "tokens.json"), stateDir, client: async () => anafOAuthClient(config), now: () => NOW });
    const error = await errorOf(() => grant.access.get());
    expect(error).toMatchObject({ kind: "config" });
    expect(error?.message).toContain("begin_authorization");
  });
});

describe("the authorization adapter", () => {
  it("builds ANAF's authorize URL with the registered redirect and a jwt token type", () => {
    const url = new URL(authorizeUrl(config, "https://example.test/cb", "s1"));
    expect(url.origin + url.pathname).toBe(ANAF.authorize);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client-id",
      redirect_uri: "https://example.test/cb",
      token_content_type: "jwt",
      state: "s1",
    });
  });

  it("reads code and state from a whole address or from its query alone", () => {
    expect(fromRedirect("https://example.test/cb?code=abc&state=s1")).toEqual({ code: "abc", state: "s1" });
    expect(fromRedirect(" code=abc&state=s1#frag ")).toEqual({ code: "abc", state: "s1" });
    expect(fromRedirect("https://example.test/cb")).toEqual({ code: undefined, state: undefined });
  });

  it("exchanges a code through the same client, sending the redirect it was issued for", async () => {
    const spy = withFetch(async () => granted());
    const auth = makeAuthorization({ config: async () => config, client: async () => anafOAuthClient(config), stateDir: tempDir("auth") });
    const issued = await auth.exchangeCode("the-code", "https://example.test/cb");
    const form = new URLSearchParams(String(spy.mock.calls[0]?.[1]?.body));
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "https://example.test/cb",
      token_content_type: "jwt",
    });
    expect(issued).toMatchObject({ refreshToken: "new-refresh", roles: "EFACTURA@ETRANSPORT" });
  });

  it("keeps one begun authorization at 0600 in the state dir, and forgets it on clear", async () => {
    const stateDir = tempDir("auth");
    const { pending } = makeAuthorization({ config: async () => config, client: async () => anafOAuthClient(config), stateDir });
    await pending.write({ state: "s1", redirectUri: "https://example.test/cb", createdAtEpoch: NOW });
    expect(await pending.read()).toEqual({ state: "s1", redirectUri: "https://example.test/cb", createdAtEpoch: NOW });
    expect(statSync(join(stateDir, "authorization.json")).mode & 0o777).toBe(0o600);
    await pending.clear();
    expect(await pending.read()).toBeUndefined();
  });
});
