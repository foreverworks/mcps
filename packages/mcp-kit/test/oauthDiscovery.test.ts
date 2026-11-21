import { describe, expect, it } from "vitest";

import { authorizationServerUrls, discoverOAuth, isSecureUrl, protectedResourceUrl, registerPublicClient, resourceMetadataUrlOf } from "../src/oauthDiscovery.js";

const fail = (message: string): never => {
  throw new Error(message);
};

const RESOURCE = "https://api.example.com/mcp";
const ISSUER = "https://auth.example.com/auth/v1";

type Route = { readonly status?: number; readonly headers?: Record<string, string>; readonly body?: unknown };
const fakeFetch = (routes: Record<string, Route>, asked: string[] = []): typeof fetch =>
  (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    asked.push(key);
    const route = routes[key];
    if (route === undefined) return new Response("not found", { status: 404 });
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: route.headers ?? {} });
  }) as typeof fetch;

const SERVER = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  registration_endpoint: `${ISSUER}/oauth/clients/register`,
  scopes_supported: ["openid", "offline_access"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
};
const META = "https://api.example.com/.well-known/oauth-protected-resource/mcp";
const routes = (): Record<string, Route> => ({
  [`POST ${RESOURCE}`]: { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${META}"` } },
  [`GET ${META}`]: { body: { resource: RESOURCE, authorization_servers: [ISSUER], scopes_supported: ["openid"] } },
  [`GET https://auth.example.com/.well-known/oauth-authorization-server/auth/v1`]: { body: SERVER },
});

describe("addresses", () => {
  it("reads the challenge's resource_metadata, quoted or bare", () => {
    expect(resourceMetadataUrlOf(`Bearer realm="x", resource_metadata="${META}"`)).toBe(META);
    expect(resourceMetadataUrlOf(`Bearer resource_metadata=${META}`)).toBe(META);
    expect(resourceMetadataUrlOf("Bearer")).toBeUndefined();
    expect(resourceMetadataUrlOf(null)).toBeUndefined();
  });
  it("builds the well-known addresses of RFC 9728 and RFC 8414", () => {
    expect(protectedResourceUrl(RESOURCE)).toBe(META);
    expect(protectedResourceUrl("https://api.example.com/")).toBe("https://api.example.com/.well-known/oauth-protected-resource");
    expect(authorizationServerUrls(ISSUER)).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server/auth/v1",
      "https://auth.example.com/auth/v1/.well-known/oauth-authorization-server",
      "https://auth.example.com/auth/v1/.well-known/openid-configuration",
    ]);
  });
  it("accepts https and loopback http only", () => {
    expect(isSecureUrl("https://a.example.com/x")).toBe(true);
    expect(isSecureUrl("http://127.0.0.1:9/x")).toBe(true);
    expect(isSecureUrl("http://a.example.com/x")).toBe(false);
    expect(isSecureUrl("nonsense")).toBe(false);
  });
});

describe("discoverOAuth", () => {
  it("follows the 401 to the resource metadata and the server metadata", async () => {
    const found = await discoverOAuth({ resourceUrl: RESOURCE, fail, fetch: fakeFetch(routes()) });
    expect(found).toEqual({
      resource: RESOURCE,
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/oauth/authorize`,
      tokenEndpoint: `${ISSUER}/oauth/token`,
      registrationEndpoint: `${ISSUER}/oauth/clients/register`,
      resourceScopes: ["openid"],
      serverScopes: ["openid", "offline_access"],
      challengeMethods: ["S256"],
      authMethods: ["none"],
    });
  });

  it("falls back to the well-known address when the challenge names none, and to the second server address", async () => {
    const r = routes();
    r[`POST ${RESOURCE}`] = { status: 401 };
    delete r["GET https://auth.example.com/.well-known/oauth-authorization-server/auth/v1"];
    r[`GET ${ISSUER}/.well-known/oauth-authorization-server`] = { body: SERVER };
    expect((await discoverOAuth({ resourceUrl: RESOURCE, fail, fetch: fakeFetch(r) })).tokenEndpoint).toBe(`${ISSUER}/oauth/token`);
  });

  it("refuses a resource that is not protected, a metadata that names another resource or issuer, and an insecure endpoint", async () => {
    await expect(discoverOAuth({ resourceUrl: RESOURCE, fail, fetch: fakeFetch({ ...routes(), [`POST ${RESOURCE}`]: { status: 200 } }) })).rejects.toThrow("not the 401");
    const other = routes();
    other[`GET ${META}`] = { body: { resource: "https://other.example.com/mcp", authorization_servers: [ISSUER] } };
    await expect(discoverOAuth({ resourceUrl: RESOURCE, fail, fetch: fakeFetch(other) })).rejects.toThrow("describes https://other.example.com/mcp");
    const mixed = routes();
    mixed["GET https://auth.example.com/.well-known/oauth-authorization-server/auth/v1"] = { body: { ...SERVER, issuer: "https://evil.example.com" } };
    await expect(discoverOAuth({ resourceUrl: RESOURCE, fail, fetch: fakeFetch(mixed) })).rejects.toThrow("different issuer");
    const plain = routes();
    plain["GET https://auth.example.com/.well-known/oauth-authorization-server/auth/v1"] = { body: { ...SERVER, token_endpoint: "http://auth.example.com/token" } };
    await expect(discoverOAuth({ resourceUrl: RESOURCE, fail, fetch: fakeFetch(plain) })).rejects.toThrow("not an https address");
  });
});

describe("registerPublicClient", () => {
  const options = { registrationEndpoint: `${ISSUER}/oauth/clients/register`, clientName: "A bridge", redirectUris: ["http://127.0.0.1:8976/callback"], scope: "openid offline_access", fail };

  it("registers a public client with PKCE-era metadata and returns its id", async () => {
    const sent: unknown[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ client_id: "client-123" }), { status: 201 });
    }) as unknown as typeof fetch;
    expect(await registerPublicClient({ ...options, fetch: fetchImpl })).toEqual({ clientId: "client-123" });
    expect(sent[0]).toEqual({
      client_name: "A bridge",
      redirect_uris: ["http://127.0.0.1:8976/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid offline_access",
    });
  });

  it("keeps a secret the server issued and refuses a rejection or an answer with no id", async () => {
    const answer = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await registerPublicClient({ ...options, fetch: answer(201, { client_id: "c", client_secret: "s" }) })).toEqual({ clientId: "c", clientSecret: "s" });
    await expect(registerPublicClient({ ...options, fetch: answer(400, { error: "invalid_redirect_uri" }) })).rejects.toThrow("invalid_redirect_uri");
    await expect(registerPublicClient({ ...options, fetch: answer(201, {}) })).rejects.toThrow("without a client_id");
  });
});
