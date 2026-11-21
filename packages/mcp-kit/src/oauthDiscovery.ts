import { liveFetch } from "./liveFetch.js";

/**
 * What a client of a protected MCP server (or any OAuth 2.1 resource) learns
 * at run time instead of being told: where the authorization server is
 * (RFC 9728, from the 401's `WWW-Authenticate` and the resource's metadata),
 * what it offers (RFC 8414), and how to register with it (RFC 7591, dynamic
 * client registration for a public client). Nothing here names a vendor.
 *
 * The documents are read, never trusted blindly: the resource metadata must
 * name the resource asked about, the server metadata its own issuer (the two
 * mix-up checks), and every endpoint must be https, or plain http on a
 * loopback host for a test.
 *
 * `fail` is the server's own tagged failure; it must throw.
 */
export type DiscoveryFail = (message: string) => never;

export type OAuthEndpoints = {
  /** The resource, as its metadata names it. */
  readonly resource: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** Absent when the server offers no dynamic registration. */
  readonly registrationEndpoint?: string;
  /** What the resource asks for (its metadata's scopes_supported). */
  readonly resourceScopes: readonly string[];
  /** What the authorization server can grant. */
  readonly serverScopes: readonly string[];
  readonly challengeMethods: readonly string[];
  readonly authMethods: readonly string[];
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** https, or http to a loopback host (a test's fake). */
export const isSecureUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
};

/** The `resource_metadata` parameter of a Bearer challenge (RFC 9728 5.1), or undefined. */
export const resourceMetadataUrlOf = (challenge: string | null | undefined): string | undefined => {
  const quoted = /resource_metadata="([^"]+)"/i.exec(challenge ?? "");
  if (quoted?.[1] !== undefined) return quoted[1];
  return /resource_metadata=([^\s,]+)/i.exec(challenge ?? "")?.[1];
};

/** RFC 9728 3.1: the well-known document of a resource, the path of the resource appended after the well-known segment. */
export const protectedResourceUrl = (resource: string): string => {
  const url = new URL(resource);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
};

/** RFC 8414 3.1, then the form many servers serve instead (the path before the well-known segment), then OpenID's. */
export const authorizationServerUrls = (issuer: string): readonly string[] => {
  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}${path}/.well-known/oauth-authorization-server`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ];
};

const sameUrl = (a: string, b: string): boolean => a.replace(/\/$/, "") === b.replace(/\/$/, "");
const record = (value: unknown): Readonly<Record<string, unknown>> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const strings = (value: unknown): readonly string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

const TIMEOUT_MS = 15_000;

const getJson = async (fetchImpl: typeof fetch, url: string): Promise<unknown> => {
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  if (!response.ok) return undefined;
  return response.json().catch(() => undefined);
};

export type DiscoverOptions = {
  readonly resourceUrl: string;
  readonly fail: DiscoveryFail;
  readonly fetch?: typeof fetch;
};

/**
 * The authorization server of a protected MCP endpoint: ask it without a
 * token, read the challenge, then the two metadata documents. A resource that
 * answers something other than 401 to a tokenless request is not protected
 * the way this expects, and says so.
 */
export const discoverOAuth = async ({ resourceUrl, fail, fetch: fetchImpl = liveFetch }: DiscoverOptions): Promise<OAuthEndpoints> => {
  if (!isSecureUrl(resourceUrl)) return fail(`${resourceUrl} is not an https address`);
  const probe = await fetchImpl(resourceUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  }).catch((thrown: unknown) => fail(`${resourceUrl} could not be reached: ${thrown instanceof Error ? thrown.message : String(thrown)}`));
  await probe.body?.cancel().catch(() => undefined);
  if (probe.status !== 401) return fail(`${resourceUrl} answered ${probe.status} without a token, not the 401 that says where to sign in`);

  const advertised = resourceMetadataUrlOf(probe.headers.get("www-authenticate"));
  const metadataUrl = advertised ?? protectedResourceUrl(resourceUrl);
  if (!isSecureUrl(metadataUrl)) return fail(`the resource metadata address ${metadataUrl} is not https`);
  const resourceMeta = record(await getJson(fetchImpl, metadataUrl));
  const resource = text(resourceMeta["resource"]);
  if (resource === undefined) return fail(`${metadataUrl} is not an OAuth protected resource document`);
  if (!sameUrl(resource, resourceUrl)) return fail(`${metadataUrl} describes ${resource}, not ${resourceUrl}`);
  const issuer = strings(resourceMeta["authorization_servers"])[0];
  if (issuer === undefined) return fail(`${metadataUrl} names no authorization server`);
  if (!isSecureUrl(issuer)) return fail(`the authorization server ${issuer} is not https`);

  const server = await firstServerMetadata(fetchImpl, issuer);
  if (server === undefined) return fail(`no authorization server metadata found for ${issuer}`);
  const issued = text(server["issuer"]);
  if (issued === undefined || !sameUrl(issued, issuer)) return fail(`the metadata of ${issuer} names a different issuer`);
  const authorizationEndpoint = text(server["authorization_endpoint"]);
  const tokenEndpoint = text(server["token_endpoint"]);
  if (authorizationEndpoint === undefined || tokenEndpoint === undefined) return fail(`the metadata of ${issuer} has no authorization or token endpoint`);
  const registrationEndpoint = text(server["registration_endpoint"]);
  for (const endpoint of [authorizationEndpoint, tokenEndpoint, registrationEndpoint]) {
    if (endpoint !== undefined && !isSecureUrl(endpoint)) return fail(`${endpoint} is not an https address`);
  }
  return {
    resource,
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    ...(registrationEndpoint === undefined ? {} : { registrationEndpoint }),
    resourceScopes: strings(resourceMeta["scopes_supported"]),
    serverScopes: strings(server["scopes_supported"]),
    challengeMethods: strings(server["code_challenge_methods_supported"]),
    authMethods: strings(server["token_endpoint_auth_methods_supported"]),
  };
};

const firstServerMetadata = async (fetchImpl: typeof fetch, issuer: string): Promise<Readonly<Record<string, unknown>> | undefined> => {
  for (const url of authorizationServerUrls(issuer)) {
    const found = record(await getJson(fetchImpl, url).catch(() => undefined));
    if (text(found["issuer"]) !== undefined) return found;
  }
  return undefined;
};

/** A client the authorization server registered for this server. */
export type RegisteredClient = {
  readonly clientId: string;
  /** Present only when the server registered a confidential client. */
  readonly clientSecret?: string;
};

export type RegisterOptions = {
  readonly registrationEndpoint: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly scope: string;
  readonly fail: DiscoveryFail;
  readonly fetch?: typeof fetch;
};

/** RFC 7591: a public client (no secret, PKCE) for the authorization-code and refresh-token grants. */
export const registerPublicClient = async ({ registrationEndpoint, clientName, redirectUris, scope, fail, fetch: fetchImpl = liveFetch }: RegisterOptions): Promise<RegisteredClient> => {
  const response = await fetchImpl(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  }).catch((thrown: unknown) => fail(`the registration endpoint could not be reached: ${thrown instanceof Error ? thrown.message : String(thrown)}`));
  const body = record(await response.json().catch(() => undefined));
  if (!response.ok) return fail(`the authorization server refused the registration (${response.status}${text(body["error"]) === undefined ? "" : `, ${text(body["error"])}`})`);
  const clientId = text(body["client_id"]);
  if (clientId === undefined) return fail("the registration answered without a client_id");
  const clientSecret = text(body["client_secret"]);
  return { clientId, ...(clientSecret === undefined ? {} : { clientSecret }) };
};
