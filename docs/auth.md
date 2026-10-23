# Authentication, authorization and approval

For anyone who deploys these servers or reviews their security: who may call a
server, whose grant it uses at the service behind it, and who approves a call
that spends money or files a document. Facts about other products date from
2026-10-07 unless marked; UNVERIFIED means unchecked.

## What these servers do

```text
  MCP client                  MCP server (this repo)              upstream API
  (Claude Code,      --A-->   serve() -> guard -> tool  --B-->   (Google, Notion,
   Codex, ...)                           |                        ANAF, a bank)
                                         C: a person approves a consequential call
```

**A, client to server**: who may call, and as whom; only over HTTP, since over
stdio the client spawned the process. **B, server to
upstream**: whose grant the server uses at Google or a bank, and how it is
obtained, kept and renewed. **C, approval**: whether a person says yes to this
exact call before a tool that moves money or makes a legal document runs. The
layers are independent. The MCP specification covers A in detail, says little
about B, and leaves C to clients and servers.

### Layer A today

Over stdio, the default, there is no authentication, as the specification
asks; every caller is named `stdio`. Over HTTP (`MCP_HTTP_PORT` set,
[`serve.ts`](../packages/mcp-kit/src/serve.ts)), a server serves one machine:

- **Loopback, one route**: `127.0.0.1` only, `POST /mcp`, stateless (no
  session id, a fresh server per request), for both protocol generations
  ([architecture.md](architecture.md#protocol-version)).
- **A static bearer token per client**: `token-<client>` files in
  `MCP_HTTP_TOKENS_DIR`, or one `MCP_HTTP_TOKEN_FILE` for the client
  `MCP_HTTP_TOKEN_CLIENT` names. Every process and browser on the machine
  reaches loopback, so the server will not start without a token, or with one
  under 16 characters. Every token is compared in constant time, so timing
  does not reveal a near miss; a missing or wrong one gets a plain 401.
- **Browsers kept out**: a `Host` other than `127.0.0.1:<port>` or
  `localhost:<port>` gets 421 (DNS rebinding); the CORS preflight a page needs
  to send `Authorization` gets a 401 without CORS headers.
- **The token's client name is the identity** for the audit line, the rate
  limit (`MCP_HTTP_RATE`), the per-client ceiling (`MCP_CLIENT_MAX_ACCESS`),
  the binding of a question asked mid-call, and the tenant in
  `servers/devices` (never an argument).
- **No OAuth**, no Protected Resource Metadata, no `WWW-Authenticate`
  challenge: nothing off the machine reaches the listener, by design.

### Layer B today

Each server reads its credentials through the kit
([architecture.md](architecture.md#the-networking-stack)): `readSecret` takes
a `*_FILE` variable first and the plain one for a local run, and fails on a
named file that is missing or empty; `makeOAuthClient` runs the OAuth grants,
and `makeTokenSource` keeps access tokens in memory and in a 0600 file. Under
systemd, grants live in a `StateDirectory=` only the service's user reads
([configuration.md](configuration.md#conventions)).

| Server | Upstream credential | How it is obtained | Renewal |
|---|---|---|---|
| `google` | an OAuth refresh token per account and product (Gmail, Calendar, Drive, Docs/Sheets/Slides), under the operator's own OAuth client | `begin_consent` returns a Google URL (PKCE, `access_type=offline`, `prompt=consent`, `login_hint`); the account holder approves, and the redirect to a loopback address fails to load; `complete_consent` takes that address, checks the account and every scope, and saves the grant | the refresh token; consent again when Google revokes it |
| `onrc` | the signed-in person's Keycloak session (the portal's public client `frontoffice-app`) | `begin_login` / `complete_login`: an authorization code with PKCE, through the browser where the person is signed in | as long as the SSO session lasts; then `needs_login` |
| `anaf-efactura` | ANAF OAuth tokens for an application registered in `app.json` | `begin_authorization` / `complete_authorization`; the person signs in at ANAF with a qualified certificate | long-lived tokens ([provider notes](#provider-notes)); a dead refresh token needs the certificate again |
| `anaf-spv` | the taxpayer's SPV user name and password (a file, or a vault MCP server) and the code SPV e-mails (through a mail MCP server) | configured once; the server signs in by itself | a session lasts until SPV ends it; then it signs in again |
| `enable-banking` | an application id and an RS256 private key; a PSD2 session per bank consent | every request carries a JWT signed with the key; a consent is `start_auth` (`money`), then `complete_auth` with the redirect | a consent lasts up to 180 days, then the account holder repeats it |
| `notion` | one token per workspace (a personal access token or an internal integration token) | made by hand in Notion, saved as `notion-<label>` | personal access tokens expire (a year at most); by hand |
| `eas` | an Expo robot user's access token | made by hand, `EXPO_TOKEN_FILE` | does not expire; rotated by hand |
| `oblio` | the account e-mail and API secret, exchanged for an hour-long token (client credentials) | by hand, in `app.json` | automatic |
| `porkbun` | an API key and secret key | by hand | none |
| `bitwarden` | a personal API key and the master password, for the official CLI | by hand | none |
| `bolt-food`, `glovo` | a refresh token from the consumer web app (no public API) | by hand, from the browser's developer tools | about a year for Bolt; by hand |
| `trademarks`, `typesafe` | EUIPO OAuth client credentials and an optional USPTO TSDR API key; a TypeSafe API key | by hand | automatic / none |
| `bnr`, `devices` | none (public data; the operator's own SSH access to the hosts) | | |

The model never sees an upstream token (consent tools return expiry dates and
granted scopes), and the client's own credential never goes upstream.

### Layer C today

Every call passes the guard ([`guard.ts`](../packages/mcp-kit/src/serve/guard.ts),
[`confirm.ts`](../packages/mcp-kit/src/serve/confirm.ts)), which
[security.md](security.md#every-call-passes-the-guard) explains step by step.
Each tool is `read`, `write` or `money` in its server's policy, or the process
does not start, and clients see the class in the annotations (`readOnlyHint`
only for `read`, `destructiveHint: true` for `money`) and in
`_meta["foreverworks.com/access"]`. A `money` call, or one to a `write` marked
`confirm` such as the printer's print and scan, is confirmed as `MCP_CONFIRM`
says:

- **`client`** (default): by the client. Claude Code prompts on every call of
  a tool marked `_meta["anthropic/requiresUserInteraction"]: true`, whatever
  its permission mode or allow rules
  ([Claude Code, MCP](https://code.claude.com/docs/en/mcp)).
- **`elicit`**: by the server, in a form elicitation of one line (300
  characters at most) and a box to tick; the call runs only on a yes, with
  exactly the arguments confirmed. Over HTTP this needs a 2026-07-28 client,
  and a client that cannot be asked is refused (`confirmation_unavailable`).
- **`none`**: not at all; the hints only.

A tool above `MCP_MAX_ACCESS` stays listed, says it is disabled, and refuses
every call (`access_denied`); `MCP_CLIENT_MAX_ACCESS` holds a named client
lower. Each call leaves one audit line, recording whether the server confirmed
or asked, never the arguments, results or tokens.

## Layer A: client to MCP server

### What the specification says

The current revision is **2026-07-28**
([versioning](https://modelcontextprotocol.io/specification/versioning),
[changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)).
Its [authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
rules arrived in [2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/changelog)
and were reshaped in [2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/changelog)
and [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/changelog):

- **OPTIONAL**: HTTP "SHOULD conform"; stdio "SHOULD NOT follow this
  specification, and instead retrieve credentials from the environment".
- The server is an **OAuth 2.1 resource server** and **MUST** publish
  **Protected Resource Metadata** ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728))
  naming its authorization server (AS), at
  `/.well-known/oauth-protected-resource/<path>` or in a 401's
  `WWW-Authenticate`.
- **Registration**: a pre-registered client id, else a Client ID Metadata
  Document (CIMD: an HTTPS `client_id` whose JSON names the client,
  [draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00)),
  else Dynamic Client Registration (DCR, [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)),
  deprecated in 2026-07-28 ([PR #2858](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2858)).
- Clients **MUST** use PKCE and the **RFC 8707 `resource`** (such as
  `https://mcp.example.com/mcp`), and check `iss`
  ([RFC 9207](https://datatracker.ietf.org/doc/html/rfc9207)).
- Servers **MUST** accept only tokens "issued specifically for them as the
  intended audience" and "**MUST NOT** accept or transit any other tokens" (no
  **token passthrough**). Too little scope gets 403 `insufficient_scope`, and
  `tools/list` "MAY vary by the authorization presented"
  ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).

**Extensions** are optional ([ext-auth](https://github.com/modelcontextprotocol/ext-auth),
[overview](https://modelcontextprotocol.io/extensions/auth/overview)).
**Enterprise-Managed Authorization** (SEP-990,
[announced 2026-06-18](https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/))
lets a company IdP decide which servers a user reaches (ID-JAG; Okta's "Cross
App Access"). **OAuth Client Credentials** (SEP-1046, a draft,
[page](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials))
is machine access with a JWT assertion or a secret, the closest standard to
these servers' static tokens.

### What the SDK gives a server

The servers run on TypeScript SDK v2 (`@modelcontextprotocol/server`, released
2026-07-27; v1 stops at 2025-11-25, with fixes for six months or more,
[typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)). Its
resource-server half takes a web-standard `Request`, which the kit's
`node:http` server can supply. `requireBearerAuth` answers the verified
`AuthInfo`, or the 401 or 403 with its `WWW-Authenticate`, given the JWT or
introspection check a deployment supplies (`OAuthTokenVerifier`); its
`expectedResource` refuses a token for another audience.
`buildOAuthProtectedResourceMetadata` and `oauthMetadataResponse` serve the
RFC 9728 document, and tools read `AuthInfo` as `ctx.http.authInfo`. The
authorization-server half (`mcpAuthRouter`, DCR) is a "deprecated, frozen v1
copy" in `@modelcontextprotocol/server-legacy/auth`, with the advice to
"migrate AS to a dedicated IdP/OAuth library".

### Options

**A1. Static bearer tokens (what the servers do).** For: no moving parts or
network dependency; rotation is a new file and a restart. Against: OAuth-only
clients cannot connect; no expiry, scope or user; a leaked file is a full
credential. Right for one person on one machine or a private network.

**A2. An identity-aware proxy in front.** For: login and MFA are someone
else's product. Against: most proxies expect browser cookies, which MCP
clients lack, unless the proxy speaks MCP authorization; and a server that
trusts an identity header must be reachable only through the proxy.

| Proxy | MCP-aware? | Notes |
|---|---|---|
| [Tailscale `serve`](https://tailscale.com/kb/1312/serve) | identity headers, no OAuth | adds `Tailscale-User-Login`, `-Name`, `-Profile-Pic`, strips spoofed copies; none for tagged devices or Funnel; pairs with A1 or a header-trusting mode |
| [tsidp](https://github.com/tailscale/tsidp) | yes, pre-1.0 | Tailscale's OIDC/OAuth server: DCR behind `allow_dcr`, RFC 8693 token exchange; CIMD UNVERIFIED |
| [Tailscale Aperture](https://www.tailscale.com/docs/aperture/mcp-server) | gateway | GA 2026-08-26; tailnet identity, deny by default; upstream by static token, per-user OAuth or DCR |
| [Pomerium](https://www.pomerium.com/docs/capabilities/mcp/reference) | yes, since v0.30.0 | the AS for MCP clients (CIMD by domain); upstream OAuth per user, the token injected as `Bearer`, a signed `X-Pomerium-Assertion` |
| [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/) | yes | "Managed OAuth": Access as the AS (RFC 8414 and 9728, DCR), `Cf-Access-Jwt-Assertion` to validate; [MCP server portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/) with service tokens; CIMD UNVERIFIED; traffic through Cloudflare |
| [oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy/issues/3167) | no | v7.15.5 answers 403 without `WWW-Authenticate`; [PR #3488](https://github.com/oauth2-proxy/oauth2-proxy/pull/3488) (RFC 9728, DCR) open |
| Others | yes | [Docker MCP Gateway](https://github.com/docker/mcp-gateway), [Microsoft MCP Gateway](https://github.com/microsoft/mcp-gateway) (Entra ID roles), [Agent Router](https://theagentrouter.ai/docs/capabilities/mcp/) (formerly Envoy AI Gateway: JWT validation, tool rules) |

**A3. A resource server here, an external AS.** The server checks JWTs (the
issuer's JWKS signature, `iss`, `aud` or `resource` equal to its URL, `exp`,
scopes per tool class) and serves the metadata. For: the specification's
model; `sub` names a real user for audit, rate limits and grants; no passwords
here. Against: an AS to run or rent, many without the CIMD that Claude.ai,
ChatGPT and Codex prefer; public HTTPS for cloud clients; JWKS caching and
clock skew.

| AS | DCR | CIMD | Notes |
|---|---|---|---|
| [Keycloak](https://www.keycloak.org/securing-apps/mcp-authz-server) | yes | experimental since 26.6.0 | RFC 8707 and MCP after 2025-03-26 experimental; ChatGPT's CIMD reported unsupported |
| [Auth0](https://auth0.com/ai/docs/mcp/auth-for-mcp) | yes | imported by a tenant admin | GA 2026-05-06; Token Vault for third-party tokens |
| [WorkOS AuthKit](https://workos.com/docs/authkit/mcp) | yes | automatic, off by default ([changelog](https://workos.com/changelog/client-id-metadata-support-for-mcp-auth)) | |
| [Stytch](https://stytch.com/docs/connected-apps/oauth-learn-more/client-types) | yes | behind a toggle ([blog](https://stytch.com/blog/stytch-supports-cimd/)) | |
| [Descope](https://www.descope.com/blog/post/cimd-support) | yes | GA 2026-01-27 | vaults upstream tokens |
| Clerk | UNVERIFIED | UNVERIFIED (search results only) | |
| Microsoft Entra ID | no | no ([2026-04 write-up](https://blog.pamelafox.org/2026/04/building-mcp-servers-with-entra-id-and.html)) | pre-register clients, or a proxy |
| [Okta](https://developer.okta.com/blog/2026/08/24/xaa-oidc-resource) | not checked | not checked | Cross App Access (ID-JAG) |
| [`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) | yes, 90-day TTL | yes | a library; 1.0 on 2026-09-24 |

**A4. The server as its own AS** (the SDK's legacy `mcpAuthRouter`, or the
`workers-oauth-provider` pattern). For: one thing to deploy. Against: the
repository would own client registration (DCR abuse, or CIMD's URL fetching
and SSRF), consent screens, the confused deputy when it proxies a static
upstream client id ([Security Best Practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)),
token storage and revocation. The SDK itself left this to products built for
it.

| | A1 static | A2 proxy | A3 resource server | A4 own AS |
|---|---|---|---|---|
| Header-only clients | yes | if the proxy accepts a header | with a token the operator mints | yes |
| OAuth-only clients (Claude.ai, ChatGPT) | no | if the proxy speaks MCP OAuth | yes | yes |
| Knows the user | client name | proxy headers | `sub` | yes |
| Code here, operator burden | exists, lowest | little, a proxy | moderate, an AS | large, the repository's AS |
| Spec conformant | no (authorization is optional) | depends | yes | yes |

### Client support

From vendor documentation, mostly undated; the official client matrix was
removed on 2026-05-27, and the [extensions client matrix](https://modelcontextprotocol.io/extensions/client-matrix)
covers extensions only. UNVERIFIED: the documentation says nothing.

| Client | Static header | DCR | CIMD | Own OAuth client | Localhost or private network | Elicitation form / URL | Approval prompts |
|---|---|---|---|---|---|---|---|
| [Claude Code](https://code.claude.com/docs/en/mcp) | `--header`, `headers`, `headersHelper` | yes | yes | `--client-id`, `--client-secret` | yes | yes / yes | [permission rules](https://code.claude.com/docs/en/permissions) on `mcp__<server>__<tool>`; annotations not used |
| [Claude.ai, Desktop, mobile](https://claude.com/docs/connectors/building/authentication) | beta for some organizations | yes | yes (preferred) | yes | no: from Anthropic's cloud ([`160.79.104.0/21`](https://platform.claude.com/docs/en/api/ip-addresses)), else [MCP tunnels](https://claude.com/docs/connectors/mcp-tunnels/overview) (preview) | not documented | per tool; read-only tools run unasked, destructive ones always prompt ([review criteria](https://claude.com/docs/connectors/building/review-criteria)) |
| [ChatGPT](https://developers.openai.com/apps-sdk/build/auth) | no | yes | yes (preferred) | yes | no: public HTTPS or OpenAI's tunnel | UNVERIFIED | write tools confirmed, `readOnlyHint` respected ([reference](https://developers.openai.com/plugins/reference)) |
| [Responses API](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) | `headers`, `authorization` | n/a | n/a | n/a | no: public, or a tunnel | not documented | `require_approval`: `always`, `never`, a filter |
| [Codex](https://learn.chatgpt.com/docs/extend/mcp) | `bearer_token_env_var`, `http_headers` | yes | yes | `--oauth-client-id` | yes | yes / partial (2026-07-28 bugs) | `auto` / `prompt` / `writes` / `approve` |
| [Cursor](https://cursor.com/docs/mcp) | `headers` ([ignored](https://forum.cursor.com/t/mcp-headers-config-ignored-when-server-has-oauth-discovery/156054) when the server advertises OAuth) | yes | UNVERIFIED | `auth.CLIENT_ID` | yes | yes / UNVERIFIED | asks by default; allowlist |
| VS Code (Copilot) | `headers` | yes | since 1.107 | `oauth.clientId` | yes | yes / yes | every tool not `readOnlyHint` |
| [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/) | `headers` | yes | no (#25724) | yes | yes | no (#28074) / no | unless `trust: true` |

Claude.ai calls back to `https://claude.ai/api/mcp/auth_callback`, ChatGPT to
`https://chatgpt.com/connector/oauth/{callback_id}`, local clients to
loopback; with CIMD an AS need not list them. Claude.ai and Codex use CIMD
only when the AS advertises it and accepts public clients, else DCR. Claude.ai
reads only the first `authorization_servers` entry and has no client
credentials grant. Claude Code speaks 2026-07-28 from v2.1.232; Claude.ai
follows the 2025 revisions, ChatGPT 2025-11-25.

**Single user versus many.** A1 serves one person, and A2 adds remote access.
Claude.ai and ChatGPT connect from their vendor's cloud, so they need public
HTTPS (or a vendor tunnel) and OAuth. Several people with their own upstream
grants need A3 or A4: grants (Layer B) and approvals (Layer C) bind to a
verified `sub`, and a static token cannot expire, scope or revoke per
session.

## Layer B: MCP server to the upstream API

### What the specification says

- **No token passthrough**: the server holds its own upstream grant and never
  sends the client's MCP token upstream
  ([token passthrough](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices#token-passthrough)).
- **URL-mode elicitation** ([Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation),
  [PR #887](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/887),
  since 2025-11-25) gets a grant through the client: the credentials "MUST NOT
  transit through the MCP client", and the server "MUST verify the identity of
  the user who opens the URL", usually with a `/connect` page that checks a
  session for the token's `sub`. Form mode "MUST NOT" ask for "passwords, API
  keys, access tokens, or payment credentials".
- **In 2026-07-28** a call returns `input_required`, and the client retries
  with the answer and an opaque `requestState`
  ([MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)),
  which servers MUST integrity-protect when it matters and SHOULD bind to the
  principal, a short expiry and the request.

### Patterns

**B1. Secrets in files or the environment**, `*_FILE` first, so a secret stays
out of an environment other tools dump. systemd credentials (optionally
encrypted to the TPM2, [systemd credentials](https://systemd.io/CREDENTIALS/)),
Docker and Kubernetes secrets all mount a file only the service reads.

**B2. The OAuth installed-app flow**: the operator's own client, PKCE and a
loopback redirect (`http://127.0.0.1:<port>/`). Standard, but every operator
registers a client, and the redirect must reach the browser's machine.

**B3. Out-of-band consent tools (what the servers do)**: `begin_*` returns a
URL, the person approves in a browser, and `complete_*` takes the address the
redirect landed on. For: two ordinary tool calls every client can make; the
verifier and grant stay in the server; server and browser may be different
machines. Against: a person copies an address carrying a single-use code. The
pending state is single-use and expires (15 to 30 minutes here); a multi-user
deployment must also bind it to the user who began it.

**B4. URL-mode elicitation**, the redirect coming back to the server over
HTTPS: no copy and paste, but it needs a client that declares
`elicitation.url`, a server the browser reaches, and a `/connect` page that
knows the user, so Layer A OAuth. These servers do half: B3's URL goes out by
URL elicitation where the client declares it and the transport can ask
mid-call ([architecture.md](architecture.md#links-a-person-opens)), and comes
back through `complete_*`. Nothing new is exposed, and B3's identity checks
hold (the approving account, the certificate, the person's own portal
session).

**B5. Multi-user grants**, stored under the Layer A identity (issuer and
`sub`), never an argument; a missing grant answers with a consent URL for that
user only.

| Storage at rest | Notes |
|---|---|
| 0600 JSON in a 0700 directory of the service user (these servers) | protects against other users, not root or a stolen disk |
| an encrypted file, keyed from a systemd credential | protects backups and images |
| the OS keychain | desktop stdio only, none on a headless service; `keytar` is archived ([zowe discussion](https://github.com/zowe/zowe-cli/issues/1622)) |
| a secrets manager (Vault, cloud KMS) | multi-user hosting; one more dependency |
| per-user keys derived from the user's MCP token | Cloudflare's pattern ([precedents](#how-other-open-source-mcp-servers-do-it)) |

### Provider notes

**Google.** Each operator makes a **Desktop** OAuth client, whose secret "is
obviously not treated as a secret" ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2),
[native apps](https://developers.google.com/identity/protocols/oauth2/native-app));
copy and paste ended in 2023 ([OOB migration](https://developers.google.com/identity/protocols/oauth2/resources/oob-migration)).
**Testing** mode expires refresh tokens after 7 days
([consent screen](https://support.google.com/cloud/answer/15549945)). For one
person the way out is **In production** unverified, past a warning, for up to
100 users ([unverified apps](https://support.google.com/cloud/answer/7454865)),
since "Personal Use apps" are exempt from verification
([exceptions](https://support.google.com/cloud/answer/13464323)). Most Gmail
and Drive scopes are restricted; `gmail.send`, Calendar and Sheets are
sensitive ([Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes),
[Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)).
Restricted scopes for other people need an annual assessment
([CASA](https://support.google.com/cloud/answer/13465431)), so the project
ships no shared client id. Workspace admins can use
[domain-wide delegation](https://developers.google.com/identity/protocols/oauth2/service-account).

**Notion** ([authentication](https://developers.notion.com/reference/authentication)):
one token per workspace. Integration tokens see the pages shared with them;
personal access tokens act as their user, for a year at most
([PATs](https://developers.notion.com/guides/get-started/personal-access-tokens));
public OAuth integrations suit a hosted service
([authorization](https://developers.notion.com/guides/get-started/authorization),
[changelog](https://developers.notion.com/page/changelog)). `mcp.notion.com`
takes OAuth only ([Notion MCP](https://developers.notion.com/docs/get-started-with-mcp)).

**Enable Banking**: a JWT per request, valid 24 hours at most
([quick start](https://enablebanking.com/docs/api/quick-start/),
[API](https://enablebanking.com/docs/api/reference/)); no AISP licence needed
([knowledge base](https://enablebanking.com/knowledge-base),
[FAQ](https://enablebanking.com/docs/faq/)). Restricted production mode allows
"individual non-commercial use" of linked accounts without a contract
([linked accounts](https://enablebanking.com/docs/api/linked-accounts/)).

**ANAF e-Factura** ([registration guide](https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf)):
the person authorizing signs in with a qualified certificate and rights in the
company's SPV, which no server can do for them. Access tokens last 90 days and
refresh tokens 365; each refresh returns a new pair to save; test and
production differ
([URL list](https://static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/url_eFactura.html)).
**ANAF SPV** has no API, so the server signs in as a person does. **ONRC
myportal** has no public API (UNVERIFIED): the server uses the portal's own
Keycloak client (discovery at
`https://sso.onrc.ro/realms/onrc/.well-known/openid-configuration`), which
works but is not a sanctioned integration.

**Keyed APIs**: an Expo robot user with the Developer role is the least
privilege ([programmatic access](https://docs.expo.dev/accounts/programmatic-access/));
[Oblio](https://www.oblio.eu/api)'s secret changes with the password; Porkbun
keys can be limited by IP and domain, under a spend limit
([getting started](https://kb.porkbun.com/article/190-getting-started-with-the-porkbun-api),
[API](https://porkbun.com/api/json/v3/documentation)). Bitwarden's CLI needs
the master password beside the API key
([personal API key](https://bitwarden.com/help/personal-api-key/)), and
machine accounts cannot reach vault items
([machine accounts](https://bitwarden.com/help/machine-accounts/)).

### What a deployment can choose

1. B1 for static keys, B3 for every OAuth upstream.
2. B4 with a redirect to the server only once Layer A has OAuth and clients
   speak 2026-07-28: the same begin and complete code, behind a `/connect`
   page that checks `sub`.
3. Grants keyed by account label for one user, by (issuer, `sub`, label) once
   Layer A knows users; never a fallback to another user's grant.
4. 0600 files by default; encryption at rest where backups or images matter.
5. Each operator's own OAuth client, with the provider's limits stated up
   front.

## Layer C: a human approves consequential tools

### Options

**C1. An external approvals service** reaches a person on another device. For:
the approval never passes through the client or the model, so a
prompt-injected agent cannot give it; it suits headless agents and binds once
to a digest of the exact arguments. Against: one more service, though its
protocol is small (a one-line summary, then a verdict naming who approved).

**C2. Elicitation, form mode** (`MCP_CONFIRM=elicit`): the server asks and
runs on `accept`; in 2026-07-28 a stateless server carries a digest of the
arguments in `requestState`. Against: it goes through the client the agent
drives: software can answer it (Claude Code's `Elicitation` hook can; Codex
declines under `approval_policy = "never"`), and a headless client has no
person to ask.

**C3. Elicitation, URL mode**: an approval page the server serves, the user
known by a browser session for the same `sub`. Out of band from the model, but
it needs public HTTPS and a login, so a multi-user deployment.

**C4. Client permission prompts** (Claude Code's rules on
`mcp__<server>__<tool>`, per-tool settings elsewhere, Codex's `writes`): no
server work, but a server cannot verify them, nothing binds the arguments, and
an "always allow" covers every later call.

**C5. Annotations** are hints: "Clients MUST consider tool annotations to be
untrusted unless they come from trusted servers"
([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
None says "requires confirmation"; SEP-1913 proposes trust annotations
([PR #1913](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1913)).

**C6. None**: acceptable only when C4 is configured and the operator says so.

The specification wants "a human in the loop with the ability to deny tool
invocations" and puts that duty on the client; a server that wants a
guarantee enforces it itself (C1 to C3).

### What the kit does, and what it trades

C4 with C5 by default, C2 and C6 as options, and a ceiling; C1 and C3 are not
built.

| Setting | Who confirms a money call | Holds against |
|---|---|---|
| `MCP_CONFIRM=client` | the client: Claude Code on every call, others on `destructiveHint` or their settings | a model calling a money tool on its own, through a client that honours the mark |
| `MCP_CONFIRM=elicit` | the person at the client, asked with the exact line | also a client that runs tools unasked but shows elicitations to a person |
| `MCP_CONFIRM=none` | the client's own policy | nothing beyond the hints |
| `MCP_MAX_ACCESS=write` | nobody: money tools refuse | everything, at the price of the money tools |

**The limit they share.** A client-side confirmation covers only calls made
through a client that asks. Whoever holds the credential can call without one,
and answer an elicitation too: whoever starts the process over stdio or holds
a token over HTTP, including an agent whose shell can read its own token file
([security.md](security.md#where-the-protections-stop)). Only C1, or C3 tied
to an authenticated person, holds against such a caller. Where agents have
shells and tokens, keep money tools off (`MCP_MAX_ACCESS=write`), keep the
token out of their reach, or put an out-of-band approval, outside this
project, in front of the server.

## How other open-source MCP servers do it

**[github-mcp-server](https://github.com/github/github-mcp-server)** takes a
PAT, a built-in OAuth login or GitHub App auth over stdio
([OAuth login](https://github.com/github/github-mcp-server/blob/main/docs/oauth-login.md),
[GitHub App](https://github.com/github/github-mcp-server/blob/main/docs/github-app-auth.md)),
and sends its login URL by URL elicitation when it cannot open a browser.
Over HTTP its metadata names GitHub's own OAuth server, and it uses each
request's token at GitHub, which works only because GitHub is both
([streamable HTTP](https://github.com/github/github-mcp-server/blob/main/docs/streamable-http.md)).
Least privilege is configuration: toolsets, a read-only switch, and tools
hidden when a PAT lacks scopes
([remote server](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md),
[scope filtering](https://github.com/github/github-mcp-server/blob/main/docs/scope-filtering.md)).

**[google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp#deployment--advanced-configuration)**,
the closest precedent for `google`, takes the operator's own OAuth client,
keeps 0600 token files for one user, runs FastMCP's Google OAuth proxy for
many, and verifies a gateway's signed identity JWT, failing closed
([gateway_identity.py](https://github.com/taylorwilsdon/google_workspace_mcp/blob/main/auth/gateway_identity.py)).
The [reference servers](https://github.com/modelcontextprotocol/servers#reference-servers)
keep secrets in environment variables; the
[archived](https://github.com/modelcontextprotocol/servers-archived) Google
Drive one kept a refresh token in a file.

**[notion-mcp-server](https://github.com/makenotion/notion-mcp-server)**
requires its own bearer token over HTTP, with Host and Origin checks. Notion's
hosted server is OAuth with CIMD and enterprise-managed authorization
([build a client](https://developers.notion.com/guides/mcp/build-mcp-client),
[enterprise-managed authorization](https://developers.notion.com/guides/mcp/enterprise-managed-authorization)).

**[workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)**
encrypts upstream tokens with a key wrapped by the issued token, stores tokens
hashed ([storage schema](https://github.com/cloudflare/workers-oauth-provider/blob/main/storage-schema.md),
[upstream sign-in](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/upstream-sign-in.md)),
and shows a per-client consent page against the confused deputy
([consent page](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/consent-page.md)).
[Sentry's server](https://github.com/getsentry/sentry-mcp) runs on it, and
[FastMCP](https://gofastmcp.com/servers/auth/authentication) has the same
[OAuth proxy](https://gofastmcp.com/servers/auth/oauth-proxy) for IdPs
without DCR.

**What they agree on.** Nobody authenticates stdio; local HTTP gets a bearer
token and Host checks, as here; least privilege is a deployment switch.
Upstreams without DCR (Google, GitHub, Notion, Entra) make a remote server an
OAuth proxy with encrypted upstream tokens and a consent page: A4, the
heaviest option.

## Directions

None is built. Each would widen a design made for one person or team on one
machine; roughly in this order:

1. **An OAuth resource-server mode** (A3): `MCP_AUTH=oauth` beside the static
   tokens, given an issuer URL, the canonical resource URL and optional scopes
   per class (`mcp:read`, `mcp:write`, `mcp:money`). It would serve
   `/.well-known/oauth-protected-resource/mcp`, check JWTs with SDK v2's
   helpers (or a signed gateway assertion: `X-Pomerium-Assertion`,
   `Cf-Access-Jwt-Assertion`), and make `sub` (else `client_id`) the identity
   for the guard, the audit line, the rate limit and tenancy. The AS stays
   outside, as the SDK froze its own; tested recipes (a self-hosted AS, a
   hosted AS with CIMD, a private-network gateway) would do more than code.
2. **Multi-user grants** (B5), keyed by (issuer, `sub`, account label), with a
   consent URL per user. They make B4 with a redirect, and C3, worth building.
3. **An out-of-band approval proxy** (C1) for agents with shells and tokens,
   outside the servers, as a documented recipe.
4. **A destructive flag in the policy.** A write's `destructiveHint` comes
   from the tool's own annotations (unset means destructive); a flag beside
   its class would let a reversible write (a draft, a label) say `false`.
5. **Gating the consent tools.** `begin_*` and `complete_*` change which
   account a server acts as, yet are plain `write`s outside `MCP_CONFIRM`
   (only Enable Banking's `start_auth` is `money`), held back today only by
   `MCP_CLIENT_MAX_ACCESS`. Marked `confirm` in the policy, they would be
   confirmed like money.

## Sources

Each source is linked where it is used. Also read:
[RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html),
[modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers),
[google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp),
Claude's [unlisted connectors](https://claude.com/docs/connectors/custom/add-unlisted),
OpenAI's [connect ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt),
Codex's [config reference](https://learn.chatgpt.com/docs/config-file/config-reference)
and [approvals](https://learn.chatgpt.com/docs/agent-approvals-security),
Cloudflare's [Agents authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/),
Auth0's [GA announcement](https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/),
VS Code's `mcp-configuration.md` and 1.107 release notes, and the SDK's
`docs/serving/authorization.md`. In this repository, `packages/mcp-kit/src`
(`serve.ts`, `serve/`, `oauth.ts`, `tokens.ts`, `secret.ts`, `policy.ts`).
