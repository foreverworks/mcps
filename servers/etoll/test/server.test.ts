/**
 * The server as a client sees it, through the kit's guard, end to end against
 * a fake Keycloak and a fake eToll: never connected, a browser sign-in, a
 * password sign-in (from a file and from a vault MCP server), a refused
 * password, the reads, and a purchase from quote to payment page, with every
 * way it is refused.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ACCESS_META, checkPolicy, confirmingClient, connectInMemory, elicitingClient, guard, idempotentWrites, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { type BuildOptions, buildDeps } from "../src/composition.js";
import { dayStartStamp } from "../src/domain/dates.js";
import { vocabularyFor } from "../src/mcp/envelope.js";
import { policyFor } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { vaultConnect } from "../src/infra/credentials.js";
import {
  ACTIVE_TOLL,
  API,
  BILLING,
  type Call,
  challengeOf,
  CHECKOUT,
  COMPANY,
  COMPONENTS,
  EARLIER_TOLL,
  ENDS,
  fakeNetwork,
  INCIDENTS,
  inMemoryVault,
  INVOICES,
  json,
  LOGOUT_URL,
  NOTIFICATIONS,
  ORDERED_TOLL,
  parse,
  PASSWORD,
  PAYMENT,
  PDF,
  PERSON,
  portalError,
  PROFILE,
  QUOTES,
  REDIRECT,
  type Routes,
  SCHEDULES,
  START,
  stateDir,
  STATUS,
  TOKEN_URL,
  tokenAnswer,
  TODAY,
  UNTIL,
  USERNAME,
  vaultServer,
  VEHICLES,
} from "./helpers.js";

type Options = { readonly confirm?: (line: string) => boolean; readonly build?: BuildOptions };

const connected = async (env: NodeJS.ProcessEnv, options: Options = {}) => {
  const { deps } = buildDeps(env, { sleep: async () => undefined, ...options.build });
  const server = new McpServer({ name: "etoll", version: "test" });
  registerAll(
    guard(server, { service: "etoll", policy: policyFor(deps), settings: { maxAccess: "money", confirm: "elicit" }, log: () => undefined, vocabulary: vocabularyFor(deps.loginScript) }),
    deps,
  );
  const { client: confirming, asked } = confirmingClient("test", options.confirm ?? (() => true));
  const client = await connectInMemory(server, confirming);
  return { call: async (name: string, args: Record<string, unknown> = {}) => parse(await client.callTool({ name, arguments: args })), client, deps, asked };
};

/**
 * A Keycloak that takes one code and one password and refreshes until told
 * the session is over, and an eToll with one car, one invoice and a
 * checkout. `state` switches the answers a test needs changed.
 */
const world = () => {
  let tokens = 0;
  const state = {
    sessionOver: false,
    passwordRefused: false,
    listed: [EARLIER_TOLL] as unknown[],
    quotes: [QUOTES] as unknown[],
    billing: BILLING as unknown,
    checkout: CHECKOUT as unknown,
    order: undefined as Response | undefined,
    payment: PAYMENT as unknown,
    deleted: [] as string[],
    goneAnswer: (): Response => portalError(404, "ORDER_NOT_FOUND", "Order not found"),
    firstVehiclesAnswer: undefined as Response | undefined,
  };
  let vehicleAnswers = 0;
  const routes: Routes = {
    [`POST ${TOKEN_URL}`]: (call) => {
      const grant = call.form?.["grant_type"];
      if (grant === "authorization_code") return call.form?.["code"] === "code-ok" ? tokenAnswer(++tokens) : json({ error: "invalid_grant", error_description: "Code not valid" }, 400);
      if (grant === "password") {
        if (state.passwordRefused || call.form?.["username"] !== USERNAME || call.form?.["password"] !== PASSWORD) return json({ error: "invalid_grant", error_description: "Invalid user credentials" }, 401);
        return tokenAnswer(++tokens);
      }
      if (state.sessionOver) return json({ error: "invalid_grant", error_description: "Session not active" }, 400);
      return tokenAnswer(++tokens);
    },
    [`POST ${LOGOUT_URL}`]: () => new Response(null, { status: 204 }),
    [`GET ${API}/profiles`]: () => [{ ...PROFILE, id: "prof-0002", email: "ion.ionescu@example.com", isCurrent: false }, PROFILE],
    [`GET ${API}/profiles/current/billingDetails`]: () => state.billing,
    [`GET ${API}/vehicles`]: () => (vehicleAnswers++ === 0 && state.firstVehiclesAnswer ? state.firstVehiclesAnswer : VEHICLES),
    [`GET ${API}/tolls`]: (call) => (call.query["cursor"] ? { tolls: [], errors: [], nextCursor: null } : { tolls: state.listed, total: null, errors: [], nextCursor: "c-2" }),
    [`GET ${API}/invoices`]: () => INVOICES,
    [`GET ${API}/invoices/inv-0001/pdf`]: () => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } }),
    [`GET ${API}/invoices/inv-html/pdf`]: () => new Response("<html>maintenance</html>", { status: 200, headers: { "content-type": "text/html" } }),
    [`GET ${API}/notifications`]: () => NOTIFICATIONS,
    [`GET ${API}/notifications/summary`]: () => ({ count: 1 }),
    [`POST ${API}/quotes`]: () => (state.quotes.length > 1 ? state.quotes.shift() : state.quotes[0]),
    [`POST ${API}/orders`]: () => state.order ?? state.checkout,
    [`POST ${API}/orders/ord-0001/payment`]: () => state.payment,
    [`DELETE ${API}/orders/ord-0001`]: () => {
      const gone = state.deleted.includes("ord-0001");
      state.deleted.push("ord-0001");
      return gone ? state.goneAnswer() : new Response(null, { status: 200 });
    },
    [`GET ${STATUS}/components`]: () => COMPONENTS,
    [`GET ${STATUS}/incidents`]: () => INCIDENTS,
    [`GET ${STATUS}/schedules`]: () => SCHEDULES,
  };
  return { calls: fakeNetwork(routes), state };
};


/** Begin and complete a browser sign-in against the fake Keycloak; returns what complete_login answered. */
const signIn = async (call: (name: string, args?: Record<string, unknown>) => Promise<any>) => {
  const begun = await call("begin_login");
  const url = new URL(begun.url);
  return call("complete_login", { redirect_url: `${url.searchParams.get("redirect_uri")}?state=${url.searchParams.get("state")}&code=code-ok` });
};

const withPasswordFile = (dir: string): NodeJS.ProcessEnv => {
  const file = join(dir, "password.txt");
  writeFileSync(file, `${PASSWORD}\n`);
  return { ETOLL_STATE_DIR: dir, ETOLL_USERNAME: USERNAME, ETOLL_PASSWORD_FILE: file };
};

const tokenCalls = (calls: readonly Call[], grant?: string) => calls.filter((c) => c.url === TOKEN_URL && (grant === undefined || c.form?.["grant_type"] === grant));

describe("the etoll server", () => {
  it("classifies every tool, and place_order is its one money tool", async () => {
    const { deps } = buildDeps({ ETOLL_STATE_DIR: stateDir() });
    expect(() => checkPolicy("etoll", (s) => registerAll(s, deps), policyFor(deps))).not.toThrow();
    const { client } = await connected({ ETOLL_STATE_DIR: stateDir() });
    const { tools } = await client.listTools();
    expect(tools.filter((t) => t._meta?.[ACCESS_META] === "money").map((t) => t.name)).toEqual(["place_order"]);
    expect(tools.find((t) => t.name === "cancel_order")?.annotations?.idempotentHint).toBe(true);
  });

  it("keeps its state in ETOLL_STATE_DIR, else the kit's one default, and builds with nothing set", () => {
    expect(buildDeps({ ETOLL_STATE_DIR: "/srv/etoll" }).config.stateDir).toBe("/srv/etoll");
    expect(buildDeps({ HOME: "/home/u" }).config.stateDir).toBe("/home/u/.local/state/mcps/etoll");
    const { config } = buildDeps({});
    expect(config).toMatchObject({ clientId: "ddcm-authz-client", api: "https://portal.etoll.ro", redirectUri: REDIRECT, scopes: ["openid", "profile", "offline_access"] });
  });

  it("tells an agent what to do before anyone has signed in and no password is set: needs_login, with the browser tools", async () => {
    world();
    const { call } = await connected({ ETOLL_STATE_DIR: stateDir(), ETOLL_LOGIN_SCRIPT: "example-login" });
    expect(await call("health")).toMatchObject({ ok: true, session: "none", password_sign_in: { kind: "none" }, login_script: "example-login" });
    const status = await call("session_status");
    expect(status).toMatchObject({ connected: false, reason: "never_connected", password_sign_in: false });
    expect(status.next).toMatch(/^run `example-login`: /);
    const refused = await call("list_vehicles");
    expect(refused.error).toMatchObject({ kind: "needs_login", reason: "never_connected" });
    expect(refused.error.remedy).toContain("begin_login");
    expect(refused.error.remedy).toContain("ETOLL_PASSWORD_FILE");
  });

  it("signs in through the browser: PKCE, response_mode=query to the portal's static file, offline_access, the verifier never leaving the server", async () => {
    const { calls } = world();
    const dir = stateDir();
    const { call } = await connected({ ETOLL_STATE_DIR: dir });

    const begun = await call("begin_login");
    const url = new URL(begun.url);
    expect(url.origin + url.pathname).toBe("https://sso.etoll.ro/auth/realms/external/protocol/openid-connect/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "ddcm-authz-client",
      redirect_uri: REDIRECT,
      response_type: "code",
      response_mode: "query",
      scope: "openid profile offline_access",
      code_challenge_method: "S256",
    });
    const pending = JSON.parse(readFileSync(join(dir, "login.json"), "utf8"));
    expect(challengeOf(pending.verifier)).toBe(url.searchParams.get("code_challenge"));
    expect(JSON.stringify(begun)).not.toContain("verifier");

    const wrong = await call("complete_login", { redirect_url: `${REDIRECT}?state=someone-elses&code=code-ok` });
    expect(wrong.error).toMatchObject({ kind: "input" });
    expect(tokenCalls(calls)).toHaveLength(0);

    const done = await call("complete_login", { redirect_url: `${REDIRECT}?state=${url.searchParams.get("state")}&code=code-ok` });
    expect(done).toMatchObject({ connected: true, signedInWith: "browser", who: { email: "ana.popescu@example.com" }, refreshTokenExpiresAt: null });
    expect(tokenCalls(calls, "authorization_code")[0]?.form).toMatchObject({ code: "code-ok", redirect_uri: REDIRECT, code_verifier: pending.verifier, client_id: "ddcm-authz-client" });
    expect(JSON.stringify(done)).not.toMatch(/refresh-1|eyJ/);
    expect(statSync(join(dir, "session.json")).mode & 0o777).toBe(0o600);
  });

  it("hands the sign-in page to a client that offers links itself", async () => {
    world();
    const { deps } = buildDeps({ ETOLL_STATE_DIR: stateDir() }, { sleep: async () => undefined });
    const server = new McpServer({ name: "etoll", version: "test" });
    registerAll(guard(server, { service: "etoll", policy: policyFor(deps), log: () => undefined, vocabulary: vocabularyFor(deps.loginScript) }), deps);
    const { client: offering, asked } = elicitingClient("test", () => ({ action: "accept" }), { url: {} });
    const client = await connectInMemory(server, offering);
    const begun = parse(await client.callTool({ name: "begin_login", arguments: {} }));
    expect(begun).toMatchObject({ ok: true, client_offered_link: "accept", next: expect.stringContaining("complete_login") });
    expect(begun.url).toBeUndefined();
    expect(asked.flatMap((a) => (a.mode === "url" ? [a.url] : []))).toEqual([expect.stringMatching(/^https:\/\/sso\.etoll\.ro\//)]);
  });

  it("signs in by itself with a password from a file, read only then and kept nowhere", async () => {
    const { calls } = world();
    const dir = stateDir();
    const { call } = await connected(withPasswordFile(dir));
    expect(await call("health")).toMatchObject({ session: "none", password_sign_in: { kind: "file", username: USERNAME } });

    const listed = await call("list_vehicles");
    expect(listed.vehicles).toHaveLength(1);
    const grants = tokenCalls(calls, "password");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.form).toEqual({ grant_type: "password", username: USERNAME, password: PASSWORD, scope: "openid profile offline_access", client_id: "ddcm-authz-client" });
    expect((await call("session_status")).signedInWith).toBe("password");

    for (const name of readdirSync(dir).filter((n) => n !== "password.txt")) {
      const path = join(dir, name);
      if (statSync(path).isFile()) expect(readFileSync(path, "utf8")).not.toContain(PASSWORD);
    }
    expect(JSON.stringify(await call("health"))).not.toContain(PASSWORD);
  });

  it("signs in again with the password when Keycloak ends the session, rather than asking for the browser", async () => {
    const { calls, state } = world();
    const { call } = await connected(withPasswordFile(stateDir()));
    await call("list_vehicles");
    state.sessionOver = true;
    const probed = await call("session_status", { probe: true });
    expect(probed).toMatchObject({ connected: true, probed: true, signedInWith: "password" });
    expect(tokenCalls(calls, "refresh_token")).toHaveLength(1);
    expect(tokenCalls(calls, "password")).toHaveLength(2);
  });

  it("stops sending a refused password: login_refused, then a pause without a token call, until session_status probes", async () => {
    const { calls, state } = world();
    state.passwordRefused = true;
    const { call } = await connected(withPasswordFile(stateDir()));

    const first = await call("list_vehicles");
    expect(first.error).toMatchObject({ kind: "login_refused" });
    expect(first.error.remedy).toMatch(/do NOT call again/);
    expect(JSON.stringify(first)).not.toContain(PASSWORD);
    expect(tokenCalls(calls, "password")).toHaveLength(1);

    const second = await call("list_vehicles");
    expect(second.error).toMatchObject({ kind: "login_refused" });
    expect(second.error.message).toMatch(/not sent again before/);
    expect(tokenCalls(calls, "password")).toHaveLength(1);

    state.passwordRefused = false;
    expect(await call("session_status", { probe: true })).toMatchObject({ connected: true, signedInWith: "password" });
    expect((await call("list_vehicles")).vehicles).toHaveLength(1);
  });

  it("reads the user name and password from a vault MCP server at sign-in", async () => {
    const { calls } = world();
    const vaultCalls: string[] = [];
    const transportFor = inMemoryVault(() => vaultServer(vaultCalls));
    const env = { ETOLL_STATE_DIR: stateDir(), ETOLL_VAULT_MCP_COMMAND: "fake-vault", ETOLL_VAULT_ITEM: "item-1" };
    const { call } = await connected(env, { build: { connectFor: (endpoint) => vaultConnect(endpoint, transportFor) } });
    expect(await call("health")).toMatchObject({ password_sign_in: { kind: "mcp", transport: "stdio", tool: "get_password", item: "item-1" } });
    expect((await call("list_vehicles")).vehicles).toHaveLength(1);
    expect(vaultCalls).toEqual(["get_password item-1"]);
    expect(tokenCalls(calls, "password")[0]?.form).toMatchObject({ username: USERNAME, password: PASSWORD });
  });

  it("answers a vault token file it cannot read as config, naming the variable, before connecting", async () => {
    world();
    const dir = stateDir();
    const env = { ETOLL_STATE_DIR: dir, ETOLL_VAULT_MCP_URL: "http://127.0.0.1:9/mcp", ETOLL_VAULT_MCP_TOKEN_FILE: join(dir, "missing-token"), ETOLL_VAULT_ITEM: "item-1" };
    const { call } = await connected(env);
    const out = await call("list_vehicles");
    expect(out.error).toMatchObject({ kind: "config" });
    expect(out.error.message).toContain("ETOLL_VAULT_MCP_TOKEN_FILE");
  });

  it("lists the cars with their vignette in Bucharest days, as the portal's own screen asks for them", async () => {
    const { calls } = world();
    const { call } = await connected({ ETOLL_STATE_DIR: stateDir() });
    await signIn(call);
    const listed = await call("list_vehicles");
    expect(listed).toMatchObject({ ok: true, today: TODAY });
    expect(listed.vehicles[0]).toMatchObject({
      id: "veh-0001",
      plate: "B123ABC",
      country: "RO",
      category: "A",
      vignette: { valid_until: ENDS, days_left: 10, active: true },
      eligible: true,
      eligible_periods: [{ from: START }],
    });
    const request = calls.find((c) => c.url.startsWith(`${API}/vehicles`));
    expect(request?.query).toMatchObject({ vehicleType: "CAR", computeVignetteEligibility: "true" });
    expect(request?.authorization).toMatch(/^Bearer eyJ/);
  });

  it("renews once after a 401 and carries on", async () => {
    const { calls, state } = world();
    state.firstVehiclesAnswer = json({ status: 401, error: "Unauthorized", issues: [{ issueCode: 4010 }] }, 401);
    const { call } = await connected({ ETOLL_STATE_DIR: stateDir() });
    await signIn(call);
    expect((await call("list_vehicles")).vehicles).toHaveLength(1);
    const reads = calls.filter((c) => c.url.startsWith(`${API}/vehicles`));
    expect(reads).toHaveLength(2);
    expect(reads[0]?.authorization).not.toBe(reads[1]?.authorization);
    expect(tokenCalls(calls, "refresh_token")).toHaveLength(1);
  });

  it("reads tolls, invoices and notifications, and saves an invoice's PDF by path and hash", async () => {
    const { calls } = world();
    const dir = stateDir();
    const { call } = await connected({ ETOLL_STATE_DIR: dir });
    await signIn(call);

    const tolls = await call("list_tolls", { status: "ACTIVE", plate: "B123ABC", size: 10 });
    expect(tolls).toMatchObject({ next_cursor: "c-2" });
    expect(tolls.tolls[0]).toMatchObject({ id: "toll-0000", kind: "vignette", status: "ACTIVE", duration: "12 months", valid_until: UNTIL, price: { total: "139.41", currency: "RON" }, serial: "RO-TEST-0000" });
    expect(calls.find((c) => c.url.startsWith(`${API}/tolls?`))?.query).toEqual({ status: "ACTIVE", plateNumber: "B123ABC", size: "10" });
    await call("list_tolls", { plate: "b 123-abc", size: 10 });
    expect(calls.findLast((c) => c.url.startsWith(`${API}/tolls?`))?.query).toMatchObject({ plateNumber: "B123ABC" });

    const invoices = await call("list_invoices", { from: "2026-01-01", to: "2026-07-31" });
    expect(invoices).toMatchObject({ from: "2026-01-01", to: "2026-07-31", total: 1, last: true });
    expect(invoices.invoices[0]).toMatchObject({ id: "inv-0001", series: "ETL", number: "1234", total: "139.41", vat: "24.2", currency: "RON" });
    expect(calls.find((c) => c.url.startsWith(`${API}/invoices?`))?.query).toMatchObject({ from: "2026-01-01T00:00:00.000+02:00", to: "2026-07-31T23:59:59.999+03:00", page: "0", size: "20" });

    const saved = await call("download_invoice", { invoice_id: "inv-0001" });
    expect(saved).toMatchObject({ ok: true, path: join(dir, "outbox", "etoll-invoice-inv-0001.pdf"), size: PDF.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(readFileSync(saved.path)).toEqual(Buffer.from(PDF));
    expect((await call("download_invoice", { invoice_id: "inv-html" })).error).toMatchObject({ kind: "drift" });

    expect(await call("notifications")).toMatchObject({ unread: 1, notifications: [{ type: "VIGNETTE_EXPIRING", plate: "B123ABC", unread: true }] });
  });

  it("reads CNAIR's status page without an account: components in order, open incidents, planned maintenance", async () => {
    const { calls } = world();
    const { call } = await connected({ ETOLL_STATE_DIR: stateDir() });
    const status = await call("service_status");
    expect(status.components.map((c: { name: string; status: string }) => [c.name, c.status])).toEqual([
      ["Portal", "operational"],
      ["Plăți", "partial_outage"],
    ]);
    expect(status.open_incidents).toEqual([expect.objectContaining({ name: "Plăți cu cardul" })]);
    expect(status.maintenance).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith(STATUS)).every((c) => c.authorization === undefined)).toBe(true);
    expect(tokenCalls(calls)).toHaveLength(0);
  });
});

describe("buying a vignette", () => {
  const quoted = async (options: Options = {}) => {
    const w = world();
    const dir = stateDir();
    const s = await connected({ ETOLL_STATE_DIR: dir }, options);
    await signIn(s.call);
    const quote = await s.call("quote_vignette", { vehicle: "b-123-abc" });
    const twelve = quote.options.find((o: { duration_code: string }) => o.duration_code === "TWELVE_MONTHS");
    return { ...w, ...s, dir, quote, twelve };
  };

  const ordersSent = (calls: readonly Call[]) => calls.filter((c) => c.method === "POST" && c.url === `${API}/orders`);

  it("quotes every duration from the first day eToll allows, with exact prices, and orders nothing", async () => {
    const { calls, quote } = await quoted();
    expect(quote).toMatchObject({ ok: true, start_date: START, vehicle: { plate: "B123ABC" } });
    expect(quote.options).toEqual([
      expect.objectContaining({ quote_id: expect.stringMatching(/^q_[0-9a-f]{16}$/), duration: "12 months", valid_from: START, valid_until: UNTIL, price: expect.objectContaining({ total: "139.41", vat: "24.2", currency: "RON" }) }),
      expect.objectContaining({ duration: "30 days", price: expect.objectContaining({ total: "34.85" }) }),
    ]);
    expect(calls.find((c) => c.url === `${API}/quotes`)?.body).toEqual({ vehicleId: "veh-0001", validFrom: dayStartStamp(START), type: 0 });
    expect(ordersSent(calls)).toHaveLength(0);
  });

  it("refuses a start date in the past and a vehicle the account does not have, before asking for a price", async () => {
    world();
    const { call } = await connected({ ETOLL_STATE_DIR: stateDir() });
    await signIn(call);
    expect((await call("quote_vignette", { vehicle: "B123ABC", start_date: "2020-01-01" })).error).toMatchObject({ kind: "input" });
    expect((await call("quote_vignette", { vehicle: "CJ99XYZ" })).error).toMatchObject({ kind: "not_found" });
  });

  it("asks the user one line, orders with the exact amounts, and hands over the euplatesc.ro page", async () => {
    const { calls, call, asked, twelve } = await quoted();
    const placed = await call("place_order", { quote_id: twelve.quote_id });
    expect(asked).toEqual([
      `etoll: Buy rovinietă 12 months, category A, for B123ABC (RO), valid from ${START} to ${UNTIL}, 139.41 RON, billed to Ana Popescu, paid by card on euplatesc.ro`,
    ]);
    expect(placed).toMatchObject({ ok: true, order_id: "ord-0001", payment_url: PAYMENT.paymentUrl, total: "139.41", currency: "RON", billed_to: "Ana Popescu" });

    const order = ordersSent(calls)[0];
    expect(order?.body).toMatchObject({ type: "TOLL", source: "WEB", toll: { type: 0, vehicle: { id: "veh-0001", plateNumber: "B123ABC" }, duration: "TWELVE_MONTHS", validFrom: dayStartStamp(START) } });
    expect(order?.raw).toContain('"price":{"totalPrice":139.41,"vat":24.2,"vatPercentage":21,"priceWithoutVat":115.21}');
    const payment = calls.find((c) => c.url === `${API}/orders/ord-0001/payment`);
    expect(payment?.body).toEqual({ email: "ana.popescu@example.com", entity: { person: PERSON, organisation: null, name: "Ana Popescu" }, language: "RO", source: "WEB" });

    const pending = await call("get_order", { order_id: "ord-0001" });
    expect(pending).toMatchObject({ state: "pending", payment_url: PAYMENT.paymentUrl, vignettes: [] });
    expect(calls.findLast((c) => c.url.startsWith(`${API}/tolls?`))?.query).toMatchObject({ plateNumber: "B123ABC" });
  });

  it("reads the order back as paid once the vignette it issued is listed, and no other", async () => {
    const { call, state, twelve } = await quoted();
    await call("place_order", { quote_id: twelve.quote_id });
    state.listed = [EARLIER_TOLL, ACTIVE_TOLL];
    const paid = await call("get_order", { order_id: "ord-0001" });
    expect(paid).toMatchObject({ state: "paid", vignettes: [{ id: "toll-0001", status: "ACTIVE", serial: "RO-TEST-0001" }] });
    expect(paid.vignettes).toHaveLength(1);
    expect(paid.payment_url).toBeUndefined();
  });

  it("deletes an order eToll made but answered in a shape it cannot read, and pays nothing", async () => {
    const { calls, call, state, twelve } = await quoted();
    state.checkout = { ...CHECKOUT, tolls: "not a list" };
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "drift" });
    expect(out.error.message).toContain("(ord-0001) was deleted");
    expect(state.deleted).toEqual(["ord-0001"]);
    expect(calls.some((c) => c.url.endsWith("/payment"))).toBe(false);
  });

  it("orders nothing when the user says no", async () => {
    const { calls, call, twelve } = await quoted({ confirm: () => false });
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "confirmation_denied" });
    expect(ordersSent(calls)).toHaveLength(0);
  });

  it("refuses with PRICE_CHANGED when eToll's price moved since the quote, before ordering", async () => {
    const { calls, call, state, twelve } = await quoted();
    state.quotes = [{ quotes: [{ ...QUOTES.quotes[0], price: { ...QUOTES.quotes[0]?.price, totalPrice: 145 } }] }];
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "refused", code: "PRICE_CHANGED" });
    expect(out.error.message).toContain("145.00");
    expect(out.error.remedy).toContain("quote_vignette again");
    expect(ordersSent(calls)).toHaveLength(0);
  });

  it("drops an order whose total is not the confirmed one", async () => {
    const { calls, call, state, twelve } = await quoted();
    state.checkout = { ...CHECKOUT, tolls: [{ ...ORDERED_TOLL, price: { ...ORDERED_TOLL.price, totalPrice: 150 } }] };
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "refused", code: "PRICE_CHANGED" });
    expect(state.deleted).toEqual(["ord-0001"]);
    expect(calls.some((c) => c.url.endsWith("/payment"))).toBe(false);
  });

  it("drops the order when eToll hands over a payment page that is not on euplatesc.ro", async () => {
    const { call, state, twelve } = await quoted();
    state.payment = { ...PAYMENT, paymentUrl: "https://pay.example.com/checkout?id=1" };
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "drift" });
    expect(JSON.stringify(out)).not.toContain("pay.example.com");
    expect(state.deleted).toEqual(["ord-0001"]);
    expect((await call("get_order", { order_id: "ord-0001" })).state).toBe("cancelled");
  });

  it("cancels the order when eToll refuses the payment request", async () => {
    const { call, state, twelve } = await quoted();
    state.payment = portalError(400, "INVALID_REQUEST", "Invalid request");
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "refused", code: "INVALID_REQUEST" });
    expect(out.error.message).toContain("the order was cancelled and nothing was paid");
    expect(state.deleted).toEqual(["ord-0001"]);
    expect((await call("get_order", { order_id: "ord-0001" })).state).toBe("cancelled");
  });

  it("drops an order whose answer carries no total, and asks for no payment page", async () => {
    const { calls, call, state, twelve } = await quoted();
    state.checkout = { ...CHECKOUT, tolls: [{ ...ORDERED_TOLL, price: null }] };
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "drift" });
    expect(out.error.message).toContain("the order was cancelled and nothing was paid");
    expect(state.deleted).toEqual(["ord-0001"]);
    expect(calls.some((c) => c.url.endsWith("/payment"))).toBe(false);
  });

  it("drops an order whose total it cannot read exactly, once the order exists", async () => {
    const { calls, call, state, twelve } = await quoted();
    state.checkout = { ...CHECKOUT, tolls: [{ ...ORDERED_TOLL, price: { ...ORDERED_TOLL.price, totalPrice: 1e21 } }] };
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "drift" });
    expect(out.error.message).toContain("the order was cancelled and nothing was paid");
    expect(state.deleted).toEqual(["ord-0001"]);
    expect(calls.some((c) => c.url.endsWith("/payment"))).toBe(false);
    expect((await call("get_order", { order_id: "ord-0001" })).state).toBe("cancelled");
  });

  it("names the order still open when the payment request fails and eToll will not delete it", async () => {
    const { call, state, twelve } = await quoted();
    state.payment = portalError(400, "INVALID_REQUEST", "Invalid request");
    state.deleted = ["ord-0001"];
    state.goneAnswer = () => portalError(400, "ORDER_INVALID_STATE", "Order cannot be deleted");
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "outcome_unknown" });
    expect(out.error.message).toContain("eToll made order ord-0001, which could not be cancelled");
    expect(out.error.message).toContain("cancel_order with order_id ord-0001");
    expect(out.error.message).not.toContain("nothing was paid;");
    expect((await call("get_order", { order_id: "ord-0001" })).state).toBe("pending");
  });

  it("names the order still open when the payment page is off euplatesc.ro and the cancel fails", async () => {
    const { call, state, twelve } = await quoted();
    state.payment = { ...PAYMENT, paymentUrl: "https://pay.example.com/checkout?id=1" };
    state.deleted = ["ord-0001"];
    state.goneAnswer = () => portalError(400, "ORDER_INVALID_STATE", "Order cannot be deleted");
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "outcome_unknown" });
    expect(out.error.message).toContain("ord-0001");
    expect(JSON.stringify(out)).not.toContain("pay.example.com");
  });

  it("names the order still open when its answer is unreadable and eToll will not delete it", async () => {
    const { call, state, twelve } = await quoted();
    state.checkout = { ...CHECKOUT, tolls: "not a list" };
    state.deleted = ["ord-0001"];
    state.goneAnswer = () => portalError(400, "ORDER_INVALID_STATE", "Order cannot be deleted");
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "outcome_unknown" });
    expect(out.error.message).toContain("cancel_order with order_id ord-0001");
  });

  it("names the unpaid order eToll already has for the same vignette, and how to clear it", async () => {
    const { call, state, twelve } = await quoted();
    state.order = portalError(409, "PENDING_ORDER_SAME_PRODUCT", "You already have a pending order for this product.", "ord-0001");
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "refused", code: "PENDING_ORDER_SAME_PRODUCT", pendingOrderId: "ord-0001" });
    expect(out.error.remedy).toContain("cancel_order");
  });

  it("asks which billing entry when the account has more than one, before asking the user anything", async () => {
    const { calls, call, asked, state, twelve } = await quoted();
    state.billing = { persons: [PERSON], organisations: [COMPANY] };
    const out = await call("place_order", { quote_id: twelve.quote_id });
    expect(out.error).toMatchObject({ kind: "input" });
    expect(out.error.message).toContain("bo-0001 (organisation EXEMPLU S.R.L. (RO12345678))");
    expect(asked).toHaveLength(0);
    expect(ordersSent(calls)).toHaveLength(0);

    await call("place_order", { quote_id: twelve.quote_id, billing_id: "bo-0001" });
    expect(asked[0]).toContain("billed to EXEMPLU S.R.L. (RO12345678)");
    expect(calls.find((c) => c.url.endsWith("/payment"))?.body).toMatchObject({ entity: { organisation: COMPANY, person: null } });
  });

  it("refuses a quote id it never gave", async () => {
    const { call } = await quoted();
    expect((await call("place_order", { quote_id: "q_0000000000000000" })).error).toMatchObject({ kind: "not_found" });
  });

  it("cancels an unpaid order, and a second cancel is the same outcome with nothing more done", async () => {
    const { call, deps, state, twelve } = await quoted();
    expect(idempotentWrites(policyFor(deps))).toEqual(["cancel_order"]);
    await call("place_order", { quote_id: twelve.quote_id });
    const first = await call("cancel_order", { order_id: "ord-0001" });
    expect(first).toMatchObject({ ok: true, cancelled: true, already_gone: false });
    const second = await call("cancel_order", { order_id: "ord-0001" });
    expect(second).toMatchObject({ ok: true, cancelled: true, already_gone: true });
    expect(state.deleted).toEqual(["ord-0001", "ord-0001"]);
    expect((await call("get_order", { order_id: "ord-0001" })).state).toBe("cancelled");
  });

  it("takes a 400 with a code to a cancel as the order already gone, by its status and not its wording", async () => {
    const { call, state, twelve } = await quoted();
    state.goneAnswer = () => portalError(400, "ORDER_INVALID_STATE", "Order cannot be deleted");
    await call("place_order", { quote_id: twelve.quote_id });
    await call("cancel_order", { order_id: "ord-0001" });
    expect(await call("cancel_order", { order_id: "ord-0001" })).toMatchObject({ ok: true, cancelled: true, already_gone: true });
  });

  it("does not take a refused delete as cancelled for an order it never saw cancelled, which may be paid", async () => {
    const { call, state, twelve } = await quoted();
    await call("place_order", { quote_id: twelve.quote_id });
    state.deleted = ["ord-0001"];
    state.goneAnswer = () => portalError(400, "ORDER_INVALID_STATE", "Order cannot be deleted");
    const out = await call("cancel_order", { order_id: "ord-0001" });
    expect(out.error).toMatchObject({ kind: "refused", code: "ORDER_NOT_DELETABLE" });
    expect(out.error.remedy).toContain("get_order");
    expect((await call("get_order", { order_id: "ord-0001" })).state).toBe("pending");
    // The vignette it was in fact paid for shows up later, and get_order still says so.
    state.listed = [ACTIVE_TOLL];
    expect((await call("get_order", { order_id: "ord-0001" })).state).toBe("paid");
  });

  it("refuses to cancel an order it sees paid", async () => {
    const { call, state, twelve } = await quoted();
    await call("place_order", { quote_id: twelve.quote_id });
    state.listed = [ACTIVE_TOLL];
    expect((await call("cancel_order", { order_id: "ord-0001" })).error).toMatchObject({ kind: "refused", code: "ORDER_PAID" });
    expect(state.deleted).toEqual([]);
  });
});
