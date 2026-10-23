import { describe, expect, it } from "vitest";

import { makeErrorKit } from "../src/errors.js";
import { authorizeUrl, bearer, makeOAuthClient, mintedFrom, newPkce, newState, parseRedirect, pkceFrom, type OAuthFailure } from "../src/oauth.js";

const kit = makeErrorKit<OAuthFailure>("oauth-test");

const endpoint = (status: number, body: unknown) => {
  const seen: { body: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seen.push({ body: String(init.body), headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
};

const client = (fetchImpl: typeof fetch, clientAuth: "form" | "basic" = "form", extraForm?: Record<string, string>) =>
  makeOAuthClient({ tokenUri: "https://auth.test/token", clientId: "id", clientSecret: "s3", clientAuth, fail: kit.fail, fetch: fetchImpl, sleep: async () => undefined, ...(extraForm ? { extraForm } : {}) });

describe("makeOAuthClient", () => {
  it("refreshes with the client in the form, and reports scope and a rotated refresh token", async () => {
    const { fetchImpl, seen } = endpoint(200, { access_token: "a1", expires_in: 1200, scope: "x y", refresh_token: "r2", refresh_token_expires_in: 9 });
    const granted = await client(fetchImpl).refresh("r1");
    expect(granted).toEqual({ accessToken: "a1", expiresInSeconds: 1200, scope: "x y", refreshToken: "r2", raw: expect.objectContaining({ refresh_token_expires_in: 9 }) });
    expect(new URLSearchParams(seen[0]!.body).toString()).toBe("grant_type=refresh_token&refresh_token=r1&client_id=id&client_secret=s3");
    expect(mintedFrom(granted, 100)).toEqual({ token: "a1", expiresAtEpoch: 1300, scope: "x y" });
  });

  it("sends an endpoint's extra form fields with every grant", async () => {
    const { fetchImpl, seen } = endpoint(200, { access_token: "a" });
    await client(fetchImpl, "form", { token_content_type: "jwt" }).refresh("r");
    expect(new URLSearchParams(seen[0]!.body).get("token_content_type")).toBe("jwt");
  });

  it("sends client credentials as HTTP Basic when asked", async () => {
    const { fetchImpl, seen } = endpoint(200, { access_token: "a" });
    expect((await client(fetchImpl, "basic").clientCredentials()).expiresInSeconds).toBe(3600);
    expect(seen[0]!.headers["Authorization"]).toBe(`Basic ${Buffer.from("id:s3").toString("base64")}`);
    expect(seen[0]!.body).toBe("grant_type=client_credentials");
  });

  it("exchanges an authorization code with its PKCE verifier", async () => {
    const { fetchImpl, seen } = endpoint(200, { access_token: "a", refresh_token: "r" });
    await client(fetchImpl).authorizationCode("c0de", "http://localhost:1/cb", "verifier");
    expect(Object.fromEntries(new URLSearchParams(seen[0]!.body))).toMatchObject({ grant_type: "authorization_code", code: "c0de", redirect_uri: "http://localhost:1/cb", code_verifier: "verifier" });
  });

  it("names a refused grant by its RFC 6749 code, and an answer without a token as such", async () => {
    const refused = endpoint(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    await expect(client(refused.fetchImpl).refresh("r").catch((e: unknown) => kit.asAppError(e))).resolves.toEqual({
      kind: "grant_refused",
      status: 400,
      error: "invalid_grant",
      description: "Token has been expired or revoked.",
    });
    const empty = endpoint(200, {});
    await expect(client(empty.fetchImpl).refresh("r").catch((e: unknown) => kit.asAppError(e))).resolves.toMatchObject({ error: "no_access_token" });
  });

  it("gives bearer auth that renews through the token source", async () => {
    const forced: number[] = [];
    const auth = bearer({ get: async () => "tok", force: async () => forced.push(1) });
    expect(await auth.headers()).toEqual({ Authorization: "Bearer tok" });
    await auth.renew?.();
    expect(forced).toEqual([1]);
  });
});

describe("the authorization-code flow's pure parts", () => {
  it("derives the S256 challenge of RFC 7636's own example", () => {
    expect(pkceFrom("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toEqual({
      verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      method: "S256",
    });
  });

  it("makes a 43-character verifier and a state from the random source it is given", () => {
    const zeros = (n: number) => new Uint8Array(n);
    expect(newPkce(zeros).verifier).toBe("A".repeat(43));
    expect(newState(zeros)).toBe("A".repeat(22));
    expect(newPkce().verifier).not.toBe(newPkce().verifier);
  });

  it("builds the authorize URL with the standard parameters winning over extras", () => {
    const url = new URL(
      authorizeUrl({
        authUri: "https://accounts.example/o/oauth2/auth",
        clientId: "cid",
        redirectUri: "http://localhost:8123/",
        scopes: ["a", "b"],
        state: "st",
        pkce: pkceFrom("v".repeat(43)),
        extra: { access_type: "offline", prompt: "consent", login_hint: "x@example.com", state: "not-this" },
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.example/o/oauth2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      access_type: "offline",
      prompt: "consent",
      login_hint: "x@example.com",
      state: "st",
      response_type: "code",
      client_id: "cid",
      redirect_uri: "http://localhost:8123/",
      scope: "a b",
      code_challenge: pkceFrom("v".repeat(43)).challenge,
      code_challenge_method: "S256",
    });
  });

  it("reads a redirect: a code with its state, a refusal, or not a redirect at all", () => {
    expect(parseRedirect("http://localhost:8123/?state=s1&code=4/0Ab&scope=x")).toEqual({ kind: "code", code: "4/0Ab", state: "s1" });
    expect(parseRedirect("http://localhost:8123/?error=access_denied&state=s1")).toEqual({ kind: "refused", error: "access_denied", state: "s1" });
    expect(parseRedirect("http://localhost:8123/?code=c")).toMatchObject({ kind: "invalid", message: expect.stringMatching(/no state/) });
    expect(parseRedirect("http://localhost:8123/")).toMatchObject({ kind: "invalid" });
    expect(parseRedirect("nonsense")).toEqual({ kind: "invalid", message: "not a URL" });
  });
});
