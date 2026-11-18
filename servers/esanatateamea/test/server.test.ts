/**
 * The server as a client sees it, through the kit's guard, end to end against
 * a fake Keycloak and a fake portal: never connected, the ROeID leg, the
 * password leg (fully automatic from a vault, from a TOTP secret, and with
 * the code asked of the person), a refused password and code, the refresh
 * and its end, every read, and logout.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ACCESS_META, checkPolicy, connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { type BuildOptions, buildDeps } from "../src/composition.js";
import { vaultConnect } from "../src/infra/credentials.js";
import { totpAt, totpKeyOf } from "../src/infra/signIn/totp.js";
import { vocabularyFor } from "../src/mcp/envelope.js";
import { policy } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import {
  ACTION_URL,
  API,
  APPOINTMENT_COUNTS,
  APPOINTMENTS,
  AUTH_URL,
  type Call,
  challengeOf,
  CID,
  DIRECTIVES,
  DOCUMENT,
  DOCUMENTS,
  DOMAINS,
  EMERGENCY_CONTACTS,
  EMERGENCY_ENTRIES,
  fakeNetwork,
  html,
  inMemoryVault,
  INSURED,
  ISSUER,
  json,
  keycloakHtml,
  LOGOUT_URL,
  OTP,
  parse,
  PASSWORD,
  PDF,
  PERSON_INFORMATIONS,
  PRESCRIBED,
  redirectTo,
  REDIRECT,
  REIMBURSEMENT_SUMMARY,
  REIMBURSEMENTS,
  RELEASED,
  type Routes,
  stateDir,
  STATES,
  TODAY,
  TOKEN_URL,
  tokenAnswer,
  USERNAME,
  vaultServer,
  YEAR_AGO,
} from "./helpers.js";

const connected = async (env: NodeJS.ProcessEnv, build: BuildOptions = {}) => {
  const { deps } = buildDeps(env, { sleep: async () => undefined, ...build });
  const server = new McpServer({ name: "esanatateamea", version: "test" });
  registerAll(guard(server, { service: "esanatateamea", policy, log: () => undefined, vocabulary: vocabularyFor(deps.loginScript) }), deps);
  const client = await connectInMemory(server);
  return { call: async (name: string, args: Record<string, unknown> = {}) => parse(await client.callTool({ name, arguments: args })), client, deps };
};

/**
 * A Keycloak with one account (USERNAME, PASSWORD, then the code in
 * `state.otp`) that refreshes until told the session is over, and a portal
 * with one of everything. `state` switches the answers a test needs changed.
 */
const world = () => {
  let tokens = 0;
  const state = {
    otp: OTP,
    sessionOver: false,
    /** A page Keycloak shows after the password instead of the code step. */
    afterPassword: undefined as string | undefined,
    portalStatus: undefined as number | undefined,
    reimbursements: REIMBURSEMENTS as unknown,
    authorize: undefined as Record<string, string> | undefined,
  };
  const portal = (answer: () => unknown) => () => (state.portalStatus === undefined ? answer() : new Response("{}", { status: state.portalStatus, headers: { "content-type": "application/json" } }));
  const routes: Routes = {
    [`GET ${AUTH_URL}`]: (call) => {
      state.authorize = call.query;
      return html(keycloakHtml("login", `${ACTION_URL}?session_code=s-1&execution=pw&client_id=eSm&tab_id=t-1`), [
        "AUTH_SESSION_ID=as-1; Path=/realms/eSM/; Secure; HttpOnly",
        "KC_RESTART=kr-1; Path=/realms/eSM/; Secure; HttpOnly",
        "TS01=edge-1; Path=/",
      ]);
    },
    [`POST ${ACTION_URL}`]: (call) => {
      if (call.form?.["otp"] !== undefined) {
        if (call.form["otp"] !== state.otp) return html(keycloakHtml("login-otp", `${ACTION_URL}?session_code=s-3&execution=otp`, { type: "error", summary: "Invalid authenticator code." }));
        const back = new URL(state.authorize?.["redirect_uri"] ?? "https://nowhere.example");
        back.searchParams.set("state", state.authorize?.["state"] ?? "");
        back.searchParams.set("session_state", "ss-1");
        back.searchParams.set("code", "code-ok");
        return redirectTo(back.toString(), ["KC_RESTART=; Max-Age=0; Path=/realms/eSM/"]);
      }
      if (call.form?.["username"] !== USERNAME || call.form["password"] !== PASSWORD) {
        return html(keycloakHtml("login", `${ACTION_URL}?session_code=s-2&execution=pw`, { type: "error", summary: "Invalid username or password." }));
      }
      if (state.afterPassword !== undefined) return html(keycloakHtml(state.afterPassword, `${ACTION_URL}?session_code=s-2&execution=x`));
      return html(keycloakHtml("login-otp", `${ACTION_URL}?session_code=s-2&execution=otp&client_id=eSm&tab_id=t-1`));
    },
    [`POST ${TOKEN_URL}`]: (call) => {
      const grant = call.form?.["grant_type"];
      if (grant === "authorization_code") return call.form?.["code"] === "code-ok" ? tokenAnswer(++tokens) : json({ error: "invalid_grant", error_description: "Code not valid" }, 400);
      if (state.sessionOver) return json({ error: "invalid_grant", error_description: "Session not active" }, 400);
      return tokenAnswer(++tokens);
    },
    [`POST ${LOGOUT_URL}`]: () => new Response(null, { status: 204 }),
    [`GET ${API}/insurance/person-informations`]: portal(() => PERSON_INFORMATIONS),
    [`GET ${API}/insurance/person-informations/insured`]: portal(() => INSURED),
    [`GET ${API}/insurance/person-informations/states`]: portal(() => STATES),
    [`GET ${API}/nomenclator/services-insurance/domains`]: portal(() => DOMAINS),
    [`GET ${API}/prescription-history/prescribed`]: portal(() => PRESCRIBED),
    [`GET ${API}/prescription-history/released`]: portal(() => RELEASED),
    [`GET ${API}/reimbursement/medical-history`]: portal(() => state.reimbursements),
    [`GET ${API}/reimbursement/medical-history/summary`]: portal(() => REIMBURSEMENT_SUMMARY),
    [`POST ${API}/programari/docmed`]: portal(() => DOCUMENTS),
    [`GET ${API}/programari/docmed/doc-0001`]: portal(() => DOCUMENT),
    [`GET ${API}/programari/docmed/download/doc-0001`]: portal(() => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } })),
    [`GET ${API}/nomenclator/emergency-summary/overview`]: portal(() => EMERGENCY_ENTRIES),
    [`GET ${API}/nomenclator/person-contact/overview`]: portal(() => EMERGENCY_CONTACTS),
    [`GET ${API}/nomenclator/advance-directive/overview`]: portal(() => DIRECTIVES),
    [`GET ${API}/nomenclator/emergency-export/pdf`]: portal(() => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } })),
    [`GET ${API}/programari/appointment/summary-tabs`]: portal(() => APPOINTMENT_COUNTS),
    [`GET ${API}/programari/appointment/overview`]: portal(() => APPOINTMENTS),
  };
  return { calls: fakeNetwork(routes), state };
};

const withPasswordFile = (dir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const file = join(dir, "password.txt");
  writeFileSync(file, `${PASSWORD}\n`);
  return { ESANATATEAMEA_STATE_DIR: dir, ESANATATEAMEA_USERNAME: USERNAME, ESANATATEAMEA_PASSWORD_FILE: file, ...extra };
};

const withVault = (vaultCalls: string[], codes?: Parameters<typeof vaultServer>[1]) => {
  const transportFor = inMemoryVault(() => vaultServer(vaultCalls, codes));
  return {
    env: { ESANATATEAMEA_STATE_DIR: stateDir(), ESANATATEAMEA_VAULT_MCP_COMMAND: "fake-vault", ESANATATEAMEA_VAULT_ITEM: "item-1" },
    build: { connectFor: (endpoint: Parameters<typeof vaultConnect>[0]) => vaultConnect(endpoint, transportFor) } satisfies BuildOptions,
  };
};

const tokenCalls = (calls: readonly Call[], grant?: string) => calls.filter((c) => c.url === TOKEN_URL && (grant === undefined || c.form?.["grant_type"] === grant));
const formPosts = (calls: readonly Call[]) => calls.filter((c) => c.method === "POST" && c.url.startsWith(ACTION_URL));
const portalCalls = (calls: readonly Call[], path: string) => calls.filter((c) => c.url.startsWith(`${API}${path}`) && new URL(c.url).pathname === new URL(`${API}${path}`).pathname);

/** Begin and complete a ROeID sign-in against the fake Keycloak; returns what complete_login answered. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const roeid = async (call: (name: string, args?: Record<string, unknown>) => Promise<any>) => {
  const begun = await call("begin_login", { method: "roeid" });
  const url = new URL(begun.url);
  return call("complete_login", { redirect_url: `${REDIRECT}?state=${url.searchParams.get("state")}&session_state=ss-1&code=code-ok` });
};

describe("the esanatateamea server", () => {
  it("classifies every tool: the three login tools write, everything else reads, nothing is money", async () => {
    const { deps } = buildDeps({ ESANATATEAMEA_STATE_DIR: stateDir() });
    expect(() => checkPolicy("esanatateamea", (s) => registerAll(s, deps), policy)).not.toThrow();
    const { client } = await connected({ ESANATATEAMEA_STATE_DIR: stateDir() });
    const { tools } = await client.listTools();
    expect(tools.filter((t) => t._meta?.[ACCESS_META] !== "read").map((t) => t.name)).toEqual(["begin_login", "complete_login", "logout"]);
  });

  it("defaults to the public portal, its Keycloak client and an offline session, and keeps its state where told", () => {
    expect(buildDeps({ ESANATATEAMEA_STATE_DIR: "/srv/esm" }).config).toMatchObject({ stateDir: "/srv/esm", outboxDir: "/srv/esm/outbox" });
    expect(buildDeps({ HOME: "/home/u" }).config.stateDir).toBe("/home/u/.local/state/mcps/esanatateamea");
    expect(buildDeps({}).config).toMatchObject({ issuer: ISSUER, clientId: "eSm", portal: "https://portal.esanatateamea.ro", redirectUri: REDIRECT, scopes: ["openid", "offline_access"], keepaliveMin: 0 });
    expect(buildDeps({ ESANATATEAMEA_VAULT_CODE_TOOL: "none" }).config.vault.codeTool).toBeUndefined();
  });

  it("tells an agent what to do before anyone has signed in and no password is set", async () => {
    world();
    const { call } = await connected({ ESANATATEAMEA_STATE_DIR: stateDir(), ESANATATEAMEA_LOGIN_SCRIPT: "example-login" });
    expect(await call("health")).toMatchObject({ ok: true, session: "none", password_sign_in: { kind: "none" }, authenticator_code: { kind: "asked" }, redirect_uri: REDIRECT, login_script: "example-login" });
    const status = await call("session_status");
    expect(status).toMatchObject({ connected: false, reason: "never_connected", password_sign_in: false, automatic_code: false });
    expect(status.next).toMatch(/^run `example-login`: /);
    const refused = await call("get_insurance");
    expect(refused.error).toMatchObject({ kind: "needs_login", reason: "never_connected" });
    expect(refused.error.remedy).toContain("begin_login");
    expect((await call("begin_login", { method: "password" })).error).toMatchObject({ kind: "input" });
  });

  it("signs in with ROeID: kc_idp_hint, PKCE, response_mode=query to the portal's static file, and the state checked before the code is spent", async () => {
    const { calls } = world();
    const dir = stateDir();
    const { call } = await connected({ ESANATATEAMEA_STATE_DIR: dir });

    const begun = await call("begin_login", { method: "roeid" });
    const url = new URL(begun.url);
    expect(url.origin + url.pathname).toBe(AUTH_URL);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "eSm",
      redirect_uri: REDIRECT,
      response_type: "code",
      response_mode: "query",
      scope: "openid offline_access",
      code_challenge_method: "S256",
      kc_idp_hint: "roeid",
    });
    expect(begun).toMatchObject({ ok: true, redirect_uri: REDIRECT, expires_at: expect.any(String) });
    const pending = JSON.parse(readFileSync(join(dir, "login.json"), "utf8"));
    expect(challengeOf(pending.verifier)).toBe(url.searchParams.get("code_challenge"));
    expect(JSON.stringify(begun)).not.toContain(pending.verifier);
    expect(statSync(join(dir, "login.json")).mode & 0o777).toBe(0o600);

    const wrong = await call("complete_login", { redirect_url: `${REDIRECT}?state=someone-elses&code=code-ok` });
    expect(wrong.error).toMatchObject({ kind: "input" });
    expect(tokenCalls(calls)).toHaveLength(0);
    expect((await call("complete_login", {})).error).toMatchObject({ kind: "input" });

    const done = await call("complete_login", { redirect_url: `${REDIRECT}?state=${url.searchParams.get("state")}&session_state=ss-1&code=code-ok` });
    expect(done).toMatchObject({ connected: true, via: "roeid", signedInWith: "roeid", who: { email: "ana.popescu@example.com", name: "Ana Popescu" }, refreshTokenExpiresAt: null });
    expect(tokenCalls(calls, "authorization_code")[0]?.form).toMatchObject({ code: "code-ok", redirect_uri: REDIRECT, code_verifier: pending.verifier, client_id: "eSm" });
    expect(JSON.stringify(done)).not.toMatch(/refresh-1|eyJ/);
    expect(statSync(join(dir, "session.json")).mode & 0o777).toBe(0o600);
    expect((await call("complete_login", { redirect_url: `${REDIRECT}?state=${url.searchParams.get("state")}&code=code-ok` })).error).toMatchObject({ kind: "input" });
    expect(await call("health")).toMatchObject({ session: "present", signed_in_with: "roeid" });
  });

  it("drops a ROeID login the person refused, and spends nothing", async () => {
    const { calls } = world();
    const { call } = await connected({ ESANATATEAMEA_STATE_DIR: stateDir() });
    const begun = new URL((await call("begin_login", { method: "roeid" })).url);
    const refused = await call("complete_login", { redirect_url: `${REDIRECT}?state=${begun.searchParams.get("state")}&error=access_denied&error_description=Refuzat` });
    expect(refused.error).toMatchObject({ kind: "input", message: expect.stringContaining("access_denied") });
    expect(tokenCalls(calls)).toHaveLength(0);
    expect((await call("complete_login", { redirect_url: `${REDIRECT}?state=${begun.searchParams.get("state")}&code=code-ok` })).error.message).toContain("no ROeID login is in progress");
  });

  it("signs in by itself with the login and the code from a vault MCP server, at the first read, with Keycloak's cookies", async () => {
    const { calls, state } = world();
    const vaultCalls: string[] = [];
    const { env, build } = withVault(vaultCalls);
    const { call } = await connected(env, build);
    expect(await call("health")).toMatchObject({ session: "none", password_sign_in: { kind: "mcp", transport: "stdio", tool: "get_password", item: "item-1" }, authenticator_code: { kind: "mcp", tool: "totp" } });

    const insurance = await call("get_insurance");
    expect(insurance).toMatchObject({ ok: true, insured: "Asigurat" });
    expect(vaultCalls).toEqual(["get_password item-1", "totp item-1"]);
    const [password, code] = formPosts(calls);
    expect(password?.form).toEqual({ username: USERNAME, password: PASSWORD, credentialId: "" });
    expect(password?.cookie).toContain("AUTH_SESSION_ID=as-1");
    expect(password?.cookie).toContain("KC_RESTART=kr-1");
    expect(code?.form).toMatchObject({ otp: OTP });
    expect(code?.cookie).toContain("AUTH_SESSION_ID=as-1");
    expect(state.authorize).toMatchObject({ client_id: "eSm", response_mode: "query", redirect_uri: REDIRECT, scope: "openid offline_access" });
    expect(state.authorize?.["kc_idp_hint"]).toBeUndefined();
    const exchange = tokenCalls(calls, "authorization_code")[0]?.form;
    expect(challengeOf(exchange?.["code_verifier"] ?? "")).toBe(state.authorize?.["code_challenge"]);
    expect(calls.find((c) => c.url.startsWith(`${API}/insurance/person-informations`))?.authorization).toMatch(/^Bearer eyJ/);

    expect(await call("session_status")).toMatchObject({ connected: true, signedInWith: "password", password_sign_in: true, automatic_code: true });
    expect(formPosts(calls)).toHaveLength(2);
  });

  it("waits for the next code when the vault's is about to roll over", async () => {
    const { calls, state } = world();
    state.otp = "135791";
    const vaultCalls: string[] = [];
    const slept: number[] = [];
    const { env, build } = withVault(vaultCalls, [
      { code: OTP, secondsLeft: 2 },
      { code: "135791", secondsLeft: 30 },
    ]);
    const { call } = await connected(env, { ...build, sleep: async (ms) => void slept.push(ms) });
    expect(await call("begin_login", { method: "password" })).toMatchObject({ connected: true, via: "password" });
    expect(vaultCalls).toEqual(["get_password item-1", "totp item-1", "totp item-1"]);
    expect(slept).toEqual([3000]);
    expect(formPosts(calls)[1]?.form?.["otp"]).toBe("135791");
  });

  it("computes the code itself from a TOTP secret", async () => {
    const { state } = world();
    const now = 1_800_000_000;
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    state.otp = totpAt(totpKeyOf(secret) ?? { key: Buffer.alloc(0), algorithm: "sha1", digits: 6, period: 30 }, now).code;
    const dir = stateDir();
    const { call } = await connected(withPasswordFile(dir, { ESANATATEAMEA_TOTP_SECRET: secret }), { now: () => now });
    expect(await call("health")).toMatchObject({ password_sign_in: { kind: "file", username: USERNAME }, authenticator_code: { kind: "variable" } });
    expect(await call("session_status", { probe: true })).toMatchObject({ connected: true, probed: true, signedInWith: "password", automatic_code: true });
  });

  it("asks the person for the code when nothing can read it, and finishes with complete_login", async () => {
    const { calls } = world();
    const dir = stateDir();
    const { call } = await connected(withPasswordFile(dir));
    expect(await call("health")).toMatchObject({ authenticator_code: { kind: "asked" } });

    const asked = await call("get_insurance");
    expect(asked.error).toMatchObject({ kind: "needs_code" });
    expect(asked.error.remedy).toContain("complete_login");
    expect(statSync(join(dir, "code.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "code.json"), "utf8")).not.toContain(PASSWORD);

    const begun = await call("begin_login", { method: "password" });
    expect(begun).toMatchObject({ ok: true, connected: false, needs_code: true, expires_at: expect.any(String) });
    expect((await call("complete_login", { otp: "12345" })).error).toMatchObject({ kind: "input" });
    const done = await call("complete_login", { otp: `${OTP.slice(0, 3)} ${OTP.slice(3)}` });
    expect(done).toMatchObject({ connected: true, via: "password", who: { username: USERNAME } });
    expect(formPosts(calls).at(-1)?.form).toMatchObject({ otp: OTP });
    expect(() => statSync(join(dir, "code.json"))).toThrow();
    expect((await call("get_insurance")).ok).toBe(true);
  });

  it("answers a mistyped code as input, drops the spent form, and does not pause the password", async () => {
    const { calls } = world();
    const dir = stateDir();
    const { call } = await connected(withPasswordFile(dir));
    await call("begin_login", { method: "password" });
    const wrong = await call("complete_login", { otp: "000000" });
    expect(wrong.error).toMatchObject({ kind: "input", message: expect.stringContaining("Invalid authenticator code.") });
    expect(wrong.error.message).toContain("begin_login");
    expect(() => statSync(join(dir, "code.json"))).toThrow();
    expect(() => statSync(join(dir, "signin-refused.json"))).toThrow();
    expect((await call("complete_login", { otp: OTP })).error.message).toContain("no password sign-in is waiting");
    expect(await call("begin_login", { method: "password" })).toMatchObject({ needs_code: true });
    expect(formPosts(calls).filter((c) => c.form?.["password"] !== undefined)).toHaveLength(2);
  });

  it("refuses a wrong password in Keycloak's words, pauses it, and tries again at once on probe", async () => {
    const { calls } = world();
    const dir = stateDir();
    const file = join(dir, "password.txt");
    writeFileSync(file, "a-wrong-password\n");
    const vaultCalls: string[] = [];
    const { build } = withVault(vaultCalls);
    const { call } = await connected({ ESANATATEAMEA_STATE_DIR: dir, ESANATATEAMEA_USERNAME: USERNAME, ESANATATEAMEA_PASSWORD_FILE: file }, build);

    const first = await call("get_insurance");
    expect(first.error).toMatchObject({ kind: "login_refused", message: "Keycloak: Invalid username or password." });
    expect(first.error.remedy).toContain("do NOT call again");
    expect(JSON.parse(readFileSync(join(dir, "signin-refused.json"), "utf8"))).toMatchObject({ message: "Keycloak: Invalid username or password." });

    const again = await call("list_prescriptions");
    expect(again.error).toMatchObject({ kind: "login_refused", message: expect.stringContaining("not tried again before") });
    expect(formPosts(calls)).toHaveLength(1);

    writeFileSync(file, `${PASSWORD}\n`);
    const probed = await call("session_status", { probe: true });
    expect(probed.error).toMatchObject({ kind: "needs_code" });
    expect(formPosts(calls)).toHaveLength(2);
    expect(() => statSync(join(dir, "signin-refused.json"))).toThrow();
  });

  it("refuses a step it cannot take, naming it", async () => {
    const { state } = world();
    state.afterPassword = "login-update-password";
    const { call } = await connected(withPasswordFile(stateDir()));
    const refused = await call("begin_login", { method: "password" });
    expect(refused.error).toMatchObject({ kind: "login_refused", message: expect.stringContaining('"login-update-password"') });
  });

  it("refreshes a stored session, and signs in again by itself when Keycloak says it is over", async () => {
    const { calls, state } = world();
    const vaultCalls: string[] = [];
    const { env, build } = withVault(vaultCalls);
    let now = 1_900_000_000;
    const { call } = await connected(env, { ...build, now: () => now });
    await call("begin_login", { method: "password" });
    expect(tokenCalls(calls, "authorization_code")).toHaveLength(1);

    now += 600;
    expect((await call("get_insurance")).ok).toBe(true);
    expect(tokenCalls(calls, "refresh_token")[0]?.form).toMatchObject({ refresh_token: "refresh-1", client_id: "eSm" });
    expect(JSON.parse(readFileSync(join(env.ESANATATEAMEA_STATE_DIR, "session.json"), "utf8"))).toMatchObject({ refresh_token: "refresh-2", via: "password" });

    now += 600;
    state.sessionOver = true;
    expect((await call("get_insurance")).ok).toBe(true);
    expect(tokenCalls(calls, "authorization_code")).toHaveLength(2);
    expect(formPosts(calls)).toHaveLength(4);
  });

  it("says the session is over when Keycloak ends it and no password is configured", async () => {
    const { state } = world();
    const dir = stateDir();
    let now = 1_900_000_000;
    const { call } = await connected({ ESANATATEAMEA_STATE_DIR: dir }, { now: () => now });
    await roeid(call);
    now += 600;
    state.sessionOver = true;
    const over = await call("get_insurance");
    expect(over.error).toMatchObject({ kind: "needs_login", reason: "expired" });
    expect(await call("session_status")).toMatchObject({ connected: false, reason: "expired" });
    expect(await call("health")).toMatchObject({ session: "expired" });
  });

  it("answers a portal that refuses a fresh token as needs_login, and says a document's 500 may be its id", async () => {
    const { state } = world();
    const { call } = await connected({ ESANATATEAMEA_STATE_DIR: stateDir() });
    await roeid(call);
    state.portalStatus = 401;
    expect((await call("get_insurance")).error).toMatchObject({ kind: "needs_login", reason: "refused" });
    state.portalStatus = 404;
    expect((await call("get_medical_document", { id: "doc-0001" })).error).toMatchObject({ kind: "not_found" });
    state.portalStatus = 500;
    expect((await call("get_medical_document", { id: "doc-0001" })).error).toMatchObject({ kind: "api", status: 500, message: expect.stringContaining('check that "doc-0001" came from list_medical_documents') });
    expect((await call("download_medical_document", { id: "doc-0001" })).error).toMatchObject({ kind: "api", status: 500 });
    expect((await call("get_insurance")).error.message).not.toContain("list_medical_documents");
  });

  describe("reads", () => {
    const signedIn = async () => {
      const w = world();
      const dir = stateDir();
      const s = await connected({ ESANATATEAMEA_STATE_DIR: dir, ESANATATEAMEA_OUTBOX_DIR: join(dir, "out") });
      await roeid(s.call);
      return { ...w, ...s, dir };
    };

    it("get_insurance: the state, categories, packages with their services, and the history", async () => {
      const { call, calls } = await signedIn();
      expect(await call("get_insurance")).toEqual({
        ok: true,
        insured: "Asigurat",
        as_of: "2026-11-18",
        statuses: [{ code: "AS", description: "Asigurat", valid_from: "2026-01-01", valid_to: "2026-12-31" }],
        categories: [
          {
            code: "SAL",
            description: "Salariat",
            valid_from: "2026-01-01",
            valid_to: "2026-12-31",
            estimated_until: "2027-03-31",
            health_insurance_house: "CASEX",
            reported_by: "ANGAJATOR",
            approved_by: "CAS EXEMPLU",
          },
        ],
        packages: [{ code: "PB", name: "Pachet de bază", valid_from: "2026-01-01", services: ["Asistență medicală primară", "Asistență medicală ambulatorie de specialitate"] }],
        family_doctor_units: ["U0000001"],
        history: [
          { code: "AS", description: "Asigurat", valid_from: "2026-01-01", valid_to: "2026-12-31" },
          { code: "NA", description: "Neasigurat", valid_from: "2025-06-01", valid_to: "2025-12-31" },
        ],
      });
      expect(portalCalls(calls, "/nomenclator/services-insurance/domains")[0]?.query).toEqual({ packageName: "Pachet de bază" });
    });

    it("list_prescriptions: prescribed and released, over the last year by default, the copayment exact", async () => {
      const { call, calls } = await signedIn();
      const out = await call("list_prescriptions");
      expect(out.window).toEqual({ from: YEAR_AGO, to: TODAY });
      expect(portalCalls(calls, "/prescription-history/prescribed")[0]?.query).toEqual({ fromDate: YEAR_AGO, toDate: TODAY });
      expect(out.prescribed).toEqual([
        {
          prescription: "CEX 0000001",
          date: "2026-10-01",
          diagnosis_code: "J06",
          doctor_stencil: "S00001",
          treatment_days: 30,
          part: 1,
          drugs: [{ active_substance: "PARACETAMOLUM", concentration: "500mg", form: "COMPR.", dose: "1 x 3/zi", prescribed_quantity: 20, released_quantity: 20 }],
        },
      ]);
      expect(out.released[0]).toMatchObject({ prescription: "CEX 0000001", type: "Compensată 50%", copayment: "12.35", currency: "RON" });
      expect(out.released[0].drugs[0]).toMatchObject({ name: "PARACETAMOL EXEMPLU 500 mg", released_on: "2026-10-02", pharmacy: "Farmacia Exemplu", days: 7 });

      const narrow = await call("list_prescriptions", { from: "2026-01-01", to: "2026-06-30" });
      expect(narrow.window).toEqual({ from: "2026-01-01", to: "2026-06-30" });
      expect((await call("list_prescriptions", { from: "2026-07-01", to: "2026-06-30" })).error).toMatchObject({ kind: "input" });
      expect((await call("list_prescriptions", { from: "01.07.2026" })).error).toMatchObject({ kind: "input" });
    });

    it("list_reimbursed_services: the rows newest first and the window's total, amounts as exact text", async () => {
      const { call, calls, state } = await signedIn();
      const out = await call("list_reimbursed_services", { page: 0, size: 10 });
      expect(out).toMatchObject({
        ok: true,
        window: { from: YEAR_AGO, to: TODAY },
        summary: { total_reimbursed: "45.67", currency: "RON", services: 1, services_in_the_window_before: 3, top_providers: [{ provider: "Clinica Exemplu", total: "45.67", services: 1 }] },
        page: 0,
        total_pages: 1,
        total: 1,
        count: 1,
      });
      expect(out.items[0]).toEqual({
        date: "2026-09-10",
        type: "Ambulatoriu",
        service: "Consultație",
        description: "Consultație de specialitate",
        doctor: "Dr. Ion Exemplu",
        provider: "Clinica Exemplu",
        location: "București",
        diagnosis_code: "J06",
        diagnosis: "Infecție acută a căilor respiratorii superioare",
        reimbursed: "45.67",
        currency: "RON",
      });
      expect(portalCalls(calls, "/reimbursement/medical-history")[0]?.query).toEqual({ page: "0", size: "10", dateFrom: YEAR_AGO, dateTo: TODAY, sortBy: "serviceDate", sortDirection: "DESC" });

      state.reimbursements = { ...REIMBURSEMENTS, body: [{ ...REIMBURSEMENTS.body[0], reimbursedAmount: "patruzeci" }] };
      expect((await call("list_reimbursed_services")).error).toMatchObject({ kind: "drift" });
    });

    it("list_medical_documents, get_medical_document and download_medical_document", async () => {
      const { call, calls, dir, client } = await signedIn();
      const listed = await call("list_medical_documents");
      expect(listed).toMatchObject({ ok: true, count: 1, items: [{ id: "doc-0001", title: "Bilet de trimitere", status: "Consumat", doctor_stencil: "S00001", issued: "2026-08-01" }] });
      expect(listed.window).toBeUndefined();
      expect(portalCalls(calls, "/programari/docmed")[0]).toMatchObject({ method: "POST", body: {}, query: { page: "0", size: "20" } });

      await call("list_medical_documents", { search: "trimitere", from: "2026-01-01", to: "2026-11-01" });
      expect(portalCalls(calls, "/programari/docmed")[1]?.body).toEqual({ deLa: "2026-01-01", panaLa: "2026-11-01", search: "trimitere" });

      expect(await call("get_medical_document", { id: "doc-0001" })).toEqual({
        ok: true,
        document: {
          id: "doc-0001",
          title: "Bilet de trimitere",
          type: "BT",
          sections: [
            { title: "Medic", fields: [{ label: "Nume", value: "Dr. Ion Exemplu" }] },
            {
              title: "Diagnostic",
              fields: [
                { label: "Coduri", value: "J06, Infecție acută" },
                { label: "Urgent", value: "Nu" },
              ],
            },
          ],
        },
      });
      const notAnId = await client.callTool({ name: "get_medical_document", arguments: { id: "Bilet de trimitere" } });
      expect(notAnId.isError).toBe(true);
      expect(JSON.stringify(notAnId.content)).toContain("list_medical_documents gives");

      const saved = await call("download_medical_document", { id: "doc-0001" });
      expect(saved).toMatchObject({ ok: true, id: "doc-0001", file: { path: join(dir, "out", "docmed-doc-0001.pdf"), size: PDF.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } });
      expect(readFileSync(saved.file.path)).toEqual(Buffer.from(PDF));
    });

    it("get_emergency_summary: entries, contacts and directives, and the PDF only when asked", async () => {
      const { call, calls, dir } = await signedIn();
      const out = await call("get_emergency_summary");
      expect(out).toEqual({
        ok: true,
        entries: [{ category: "Alergii", group: "ALLERGY", title: "Alergie", description: "Penicilină", added_by: "PACIENT" }],
        contacts: [{ name: "Ion Popescu", relationship: "Frate", relationship_details: null, phone: "+44 7700 900123", email: "ion.popescu@example.com" }],
        advance_directives: [],
      });
      expect(portalCalls(calls, "/nomenclator/emergency-export/pdf")).toHaveLength(0);
      expect(portalCalls(calls, "/nomenclator/emergency-summary/overview")[0]?.query).toEqual({ page: "0", size: "100" });

      const withPdf = await call("get_emergency_summary", { pdf: true });
      expect(withPdf.file).toMatchObject({ path: join(dir, "out", "sumar-urgenta.pdf"), size: PDF.length });
    });

    it("list_appointments: the tab's rows for the signed-in person's cid, and the four counts", async () => {
      const { call, calls } = await signedIn();
      const out = await call("list_appointments");
      expect(out).toMatchObject({ ok: true, tab: "upcoming", counts: { upcoming: 1, waiting: 0, past: 2, cancelled: null }, count: 1 });
      expect(out.items[0]).toEqual({
        id: "apt-0001",
        date: "2026-12-01 10:00",
        status: "CONFIRMED",
        service: "Consultație",
        specialty: "Cardiologie",
        doctor: "Dr. Ion Exemplu",
        provider: "Clinica Exemplu",
        room: "Cabinet 2",
        address: "Strada Exemplu 1, București, București",
        minutes: 20,
        details: null,
      });
      expect(portalCalls(calls, "/programari/appointment/summary-tabs")[0]?.query).toEqual({ zone: "Europe/Bucharest", patientCID: CID });
      const upcoming = portalCalls(calls, "/programari/appointment/overview")[0]?.query;
      expect(upcoming).toMatchObject({ page: "0", size: "20", sortBy: "date", statuses: "CONFIRMED", sortDirection: "ASC", patients: CID });
      expect(upcoming?.["dateFrom"]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);

      await call("list_appointments", { tab: "past" });
      expect(portalCalls(calls, "/programari/appointment/overview")[1]?.query).toMatchObject({ scope: "PAST_TAB", sortDirection: "DESC", dateTo: expect.any(String) });
      await call("list_appointments", { tab: "cancelled" });
      expect(portalCalls(calls, "/programari/appointment/overview")[2]?.query).toMatchObject({ statuses: "CANCELLED,NOT_CONFIRMED" });
    });
  });

  it("logs out here and at Keycloak, and says when a password will sign in again", async () => {
    const { calls } = world();
    const vaultCalls: string[] = [];
    const { env, build } = withVault(vaultCalls);
    const { call } = await connected(env, build);
    await call("begin_login", { method: "password" });
    const out = await call("logout");
    expect(out).toMatchObject({ ok: true, connected: false, forgot: true, note: expect.stringContaining("signs in again") });
    expect(calls.find((c) => c.url === LOGOUT_URL)?.form).toEqual({ client_id: "eSm", refresh_token: "refresh-1" });
    expect(await call("health")).toMatchObject({ session: "none" });
    expect(await call("logout")).toMatchObject({ forgot: false });
  });
});
