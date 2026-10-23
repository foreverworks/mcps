/**
 * The server as a client sees it, through the kit's guard, end to end against
 * a fake Keycloak and a fake portal: from "never connected" through a login
 * to the reads, a renewal after a 401, the session's death at Keycloak, and
 * what every one of those tells an agent to do.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { checkPolicy, connectInMemory, elicitingClient, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { vocabularyFor } from "../src/mcp/envelope.js";
import { policy } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { type Call, challengeOf, DOCUMENTS, fakeNetwork, json, LOGOUT_URL, parse, PORTAL, REQUEST_ID, REQUESTS_PAGE, type Routes, stateDir, SUMMARY, TOKEN_URL, tokenAnswer } from "./helpers.js";

const REDIRECT = `${PORTAL}/static-pages/silent-check-sso.html`;
const API = `${PORTAL}/api/v1/portal-core/interf`;

const connected = async (env: NodeJS.ProcessEnv) => {
  const { deps } = buildDeps(env, { sleep: async () => undefined });
  const server = new McpServer({ name: "onrc", version: "test" });
  registerAll(guard(server, { service: "onrc", policy, log: () => undefined, vocabulary: vocabularyFor(deps.loginScript) }), deps);
  const client = await connectInMemory(server);
  return { call: async (name: string, args: Record<string, unknown> = {}) => parse(await client.callTool({ name, arguments: args })), client, deps };
};

/** A Keycloak that exchanges one code and refreshes until told the session is over, and a portal with one filing. */
const world = (options: { readonly sessionOver?: boolean; readonly firstPortalAnswer?: Response } = {}) => {
  let tokens = 0;
  let portalAnswers = 0;
  const state = { sessionOver: options.sessionOver ?? false, exchanged: [] as Call[] };
  const routes: Routes = {
    [`POST ${TOKEN_URL}`]: (call) => {
      if (call.form?.["grant_type"] === "authorization_code") {
        state.exchanged.push(call);
        return call.form["code"] === "code-ok" ? tokenAnswer(++tokens) : json({ error: "invalid_grant", error_description: "Code not valid" }, 400);
      }
      if (state.sessionOver) return json({ error: "invalid_grant", error_description: "Session not active" }, 400);
      return tokenAnswer(++tokens);
    },
    [`POST ${LOGOUT_URL}`]: () => new Response(null, { status: 204 }),
    [`GET ${API}/requests/v2`]: () => (portalAnswers++ === 0 && options.firstPortalAnswer ? options.firstPortalAnswer : REQUESTS_PAGE),
    [`GET ${API}/requests/${REQUEST_ID}/summary`]: () => SUMMARY,
    [`GET ${API}/opis-documents/complete/${REQUEST_ID}`]: () => DOCUMENTS,
    [`GET ${API}/calculation-notes/request-details/filter`]: () => ({ metadata: { page: 0, size: 20, pages: 0, total: 0 }, data: [] }),
    [`GET ${API}/invoices`]: () => ({ invoices: { metadata: { page: 0, size: 20, pages: 1, total: 1 }, data: [{ id: "i1", invoiceNumber: 7, date: "2026-10-01", status: "PAID", total: 50, paidValue: 50 }] } }),
  };
  return { calls: fakeNetwork(routes), state };
};

/** Begin and complete a login against the fake Keycloak; returns what complete_login answered. */
const signIn = async (call: (name: string, args?: Record<string, unknown>) => Promise<any>) => {
  const begun = await call("begin_login");
  const url = new URL(begun.url);
  return call("complete_login", { redirect_url: `${url.searchParams.get("redirect_uri")}?state=${url.searchParams.get("state")}&code=code-ok` });
};

describe("the onrc server", () => {
  it("classifies every tool, and none of them is money yet", async () => {
    const { deps } = buildDeps({ ONRC_STATE_DIR: stateDir() });
    expect(() => checkPolicy("onrc", (s) => registerAll(s, deps), policy)).not.toThrow();
    const { client } = await connected({ ONRC_STATE_DIR: stateDir() });
    const { tools } = await client.listTools();
    expect(tools.some((t) => t._meta?.["foreverworks.com/access"] === "money")).toBe(false);
  });

  it("keeps its state in ONRC_STATE_DIR, else the kit's one default, and builds with nothing set", () => {
    expect(buildDeps({ ONRC_STATE_DIR: "/srv/onrc" }).config.stateDir).toBe("/srv/onrc");
    expect(buildDeps({ STATE_DIRECTORY: "/var/lib/x" }).config.stateDir).toBe("/var/lib/x");
    expect(buildDeps({ HOME: "/home/u" }).config.stateDir).toBe("/home/u/.local/state/mcps/onrc");
  });

  it("refuses a filing id that is not one before asking the portal", async () => {
    const { calls } = world();
    const { client } = await connected({ ONRC_STATE_DIR: stateDir() });
    const out = (await client.callTool({ name: "get_request", arguments: { id: "20260001234" } })) as { isError?: boolean; content: { text: string }[] };
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toMatch(/UUID/);
    expect(calls).toHaveLength(0);
  });

  it("tells an agent what to do before anyone has signed in: needs_login, with the login tools and the deployment's script", async () => {
    world();
    const { call } = await connected({ ONRC_STATE_DIR: stateDir(), ONRC_LOGIN_SCRIPT: "example-login" });
    expect(await call("health")).toMatchObject({ ok: true, session: "none", login_script: "example-login" });
    const status = await call("session_status");
    expect(status).toMatchObject({ connected: false, reason: "never_connected" });
    expect(status.next).toMatch(/^run `example-login`: /);
    const refused = await call("list_requests");
    expect(refused.error).toMatchObject({ kind: "needs_login", reason: "never_connected" });
    expect(refused.error.remedy).toContain("begin_login");
    expect(refused.error.remedy).toContain("example-login");
  });

  it("hands the sign-in page to a client that offers links itself, and completes the login it began", async () => {
    world();
    const dir = stateDir();
    const { deps } = buildDeps({ ONRC_STATE_DIR: dir }, { sleep: async () => undefined });
    const server = new McpServer({ name: "onrc", version: "test" });
    registerAll(guard(server, { service: "onrc", policy, log: () => undefined, vocabulary: vocabularyFor(deps.loginScript) }), deps);
    const { client: offering, asked } = elicitingClient("test", () => ({ action: "accept" }), { url: {} });
    const client = await connectInMemory(server, offering);
    const begun = parse(await client.callTool({ name: "begin_login", arguments: {} }));
    expect(begun).toMatchObject({ ok: true, client_offered_link: "accept", next: expect.stringContaining("complete_login") });
    expect(begun.url).toBeUndefined();
    const shown = asked.flatMap((a) => (a.mode === "url" ? [{ url: a.url, message: a.message }] : []));
    expect(shown).toEqual([{ url: expect.stringMatching(/^https:\/\/sso\.onrc\.ro\//), message: expect.stringContaining("myportal.onrc.ro") }]);
    const url = new URL(shown[0]?.url ?? "");
    const done = parse(await client.callTool({ name: "complete_login", arguments: { redirect_url: `${REDIRECT}?state=${url.searchParams.get("state")}&code=code-ok` } }));
    expect(done).toMatchObject({ connected: true });
  });

  it("signs the user in: a PKCE code flow with response_mode=query to the portal's static page, the verifier never leaving the service", async () => {
    const { calls, state } = world();
    const dir = stateDir();
    const { call } = await connected({ ONRC_STATE_DIR: dir });

    const begun = await call("begin_login");
    const url = new URL(begun.url);
    expect(url.origin + url.pathname).toBe("https://sso.onrc.ro/realms/onrc/protocol/openid-connect/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "frontoffice-app", redirect_uri: REDIRECT, response_type: "code", response_mode: "query", scope: "openid", code_challenge_method: "S256" });
    expect(begun.redirect_uri).toBe(REDIRECT);
    expect(JSON.stringify(begun)).not.toContain("verifier");
    const pending = JSON.parse(readFileSync(join(dir, "login.json"), "utf8"));
    expect(challengeOf(pending.verifier)).toBe(url.searchParams.get("code_challenge"));
    expect(statSync(join(dir, "login.json")).mode & 0o777).toBe(0o600);

    const wrong = await call("complete_login", { redirect_url: `${REDIRECT}?state=someone-elses&code=code-ok` });
    expect(wrong.error).toMatchObject({ kind: "input" });
    expect(state.exchanged).toHaveLength(0);

    const done = await call("complete_login", { redirect_url: `${REDIRECT}?state=${url.searchParams.get("state")}&code=code-ok` });
    expect(done).toMatchObject({ connected: true, who: { username: "ana.popescu", email: "ana.popescu@example.com" } });
    expect(state.exchanged[0]?.form).toMatchObject({ grant_type: "authorization_code", code: "code-ok", redirect_uri: REDIRECT, code_verifier: pending.verifier, client_id: "frontoffice-app" });
    expect(state.exchanged[0]?.form).not.toHaveProperty("client_secret");
    expect(JSON.stringify(done)).not.toMatch(/refresh-1|eyJ/);
    expect(statSync(join(dir, "session.json")).mode & 0o777).toBe(0o600);
    expect(() => statSync(join(dir, "login.json"))).toThrow();
    expect(calls.filter((c) => c.url.startsWith(PORTAL))).toHaveLength(0);

    const status = await call("session_status");
    expect(status).toMatchObject({ connected: true, probed: false, who: { username: "ana.popescu" }, isRefreshExpired: false });
  });

  it("reads the filings with the session, as the portal's own screen asks for them", async () => {
    const { calls } = world();
    const { call } = await connected({ ONRC_STATE_DIR: stateDir() });
    await signIn(call);

    const listed = await call("list_requests", { from: "2026-09-01", to: "2026-10-05" });
    expect(listed).toMatchObject({ ok: true, count: 1, last: true, window: { from: "2026-09-01", to: "2026-10-05" } });
    expect(listed.items[0]).toMatchObject({ id: REQUEST_ID, number: 20260001234, registrationNumber: 4000123, status: "WORKING", type: "Menţiune", company: "EXEMPLU S.R.L." });
    const request = calls.find((c) => c.url.startsWith(`${API}/requests/v2`))!;
    expect(request.query).toEqual({ pageNumber: "0", maxResult: "20", sortField: "creationDate", sortDir: "DESC", fromCreationDate: "2026-08-31T21:00:00.000Z", toCreationDate: "2026-10-05T20:59:59.999Z" });
    expect(request.authorization).toMatch(/^Bearer eyJ/);

    const one = await call("get_request", { id: REQUEST_ID });
    expect(one.request).toMatchObject({ statusText: "Cerere inregistrata", resolutionDue: "2026-09-08T00:00:00", releaseDue: "2026-09-10T00:00:00", hasFilesToDownload: false });
    expect(one.documents).toHaveLength(1);
    expect(one.documents[0]).toMatchObject({ kind: "Cerere de înregistrare", pages: 5, deedNumber: null });
    expect(JSON.stringify(one)).not.toMatch(/uniqueId|idDocument/);

    expect(await call("list_calculation_notes")).toMatchObject({ count: 0, total: 0 });
    const invoices = await call("list_invoices");
    expect(invoices.items[0]).toMatchObject({ number: "7", total: "50", outstanding: "0" });
  });

  it("renews once after a 401 and carries on; the token endpoint is asked exactly once for it", async () => {
    const { calls } = world({ firstPortalAnswer: new Response("expired", { status: 401 }) });
    const { call } = await connected({ ONRC_STATE_DIR: stateDir() });
    await signIn(call);
    const listed = await call("list_requests");
    expect(listed.count).toBe(1);
    const portalCalls = calls.filter((c) => c.url.startsWith(`${API}/requests/v2`));
    expect(portalCalls).toHaveLength(2);
    expect(portalCalls[0]?.authorization).not.toBe(portalCalls[1]?.authorization);
    expect(calls.filter((c) => c.form?.["grant_type"] === "refresh_token")).toHaveLength(1);
  });

  it("knows when Keycloak has ended the session: needs_login (expired), and session_status says so without a token call", async () => {
    const { calls, state } = world();
    const { call } = await connected({ ONRC_STATE_DIR: stateDir(), ONRC_LOGIN_SCRIPT: "example-login" });
    await signIn(call);
    state.sessionOver = true;
    const probed = await call("session_status", { probe: true });
    expect(probed.error).toMatchObject({ kind: "needs_login", reason: "expired" });
    expect(probed.error.remedy).toContain("example-login");
    const status = await call("session_status");
    expect(status).toMatchObject({ connected: false, reason: "expired", isRefreshExpired: true });
    // The access token in hand outlives the SSO session by its own minutes, and the portal honours it
    // until then: a read still answers, and the agent learns from session_status that the next
    // refresh will not. Nothing is asked of Keycloak again for it.
    const tokenCalls = calls.filter((c) => c.url === TOKEN_URL).length;
    expect((await call("list_requests")).count).toBe(1);
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(tokenCalls);
  });

  it("logs out: Keycloak is told, the file is gone, and the next read asks for a login", async () => {
    const { calls } = world();
    const dir = stateDir();
    const { call } = await connected({ ONRC_STATE_DIR: dir });
    await signIn(call);
    expect(await call("logout")).toMatchObject({ connected: false, forgot: true });
    expect(calls.find((c) => c.url === LOGOUT_URL)?.form).toMatchObject({ client_id: "frontoffice-app", refresh_token: "refresh-1" });
    expect(() => statSync(join(dir, "session.json"))).toThrow();
    expect((await call("list_requests")).error).toMatchObject({ kind: "needs_login", reason: "never_connected" });
    expect(await call("logout")).toMatchObject({ forgot: false });
  });

  it("reports an answer that lost a field it depends on as drift, not as an empty list", async () => {
    world({ firstPortalAnswer: json({ content: [{ number: 1 }] }) });
    const { call } = await connected({ ONRC_STATE_DIR: stateDir() });
    await signIn(call);
    const out = await call("list_requests");
    expect(out.error).toMatchObject({ kind: "drift" });
    expect(out.error.message).toMatch(/requests\/v2/);
  });
});
