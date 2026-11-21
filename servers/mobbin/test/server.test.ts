/**
 * The server as a client sees it, through the kit's guard, against an in-process
 * stand-in for Mobbin: its MCP server behind a bearer check, and the sign-in service
 * it points at (discovery from the 401, dynamic registration, PKCE, rotating
 * refresh tokens). No network beyond loopback, no real account.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { type Fake, startFake } from "./fakeMobbin.js";

const open: Fake[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((f) => f.close()));
});

const setup = async () => {
  const fake = await startFake();
  open.push(fake);
  const stateDir = await mkdtemp(join(tmpdir(), "mobbin-state-"));
  const clock = { t: 1_800_000_000 };
  const deps = await buildDeps({}, { config: { upstreamUrl: fake.mcpUrl }, stateDir, now: () => clock.t });
  /** A client of a fresh server, as the HTTP transport builds one per request. */
  const connect = async () => {
    const server = new McpServer({ name: "mobbin", version: "test" });
    registerAll(guard(server, { service: "mobbin", policy: POLICY, log: () => undefined }), deps);
    return connectInMemory(server);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const client = await connect();
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { ...JSON.parse(result.content[0]?.text ?? "{}"), __isError: result.isError === true, __raw: result.content[0]?.text ?? "" };
  };
  /** Begin, play the browser, complete. */
  const signIn = async () => {
    const begun = await call("begin_authorization");
    const url = new URL(begun.authorize_url);
    const code = `code-${String(fake.codes.size + 1)}-${url.searchParams.get("state")}`;
    fake.codes.set(code, url.searchParams.get("code_challenge") ?? "");
    const landed = `${begun.redirect_uri}?code=${code}&state=${url.searchParams.get("state")}`;
    return { begun, code, landed, done: () => call("complete_authorization", { redirect_url: landed }) };
  };
  return { fake, stateDir, clock, deps, connect, call, signIn };
};

describe("begin_authorization", () => {
  it("finds the sign-in service from the 401, registers a public client, and returns a PKCE S256 link asking for a refresh token", async () => {
    const s = await setup();
    const begun = await s.call("begin_authorization");
    expect(begun).toMatchObject({ ok: true, redirect_uri: "http://127.0.0.1:8976/callback", scope: "openid offline_access" });
    expect(s.fake.registrations).toEqual([
      {
        client_name: "MCP bridge for Mobbin",
        redirect_uris: ["http://127.0.0.1:8976/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "openid offline_access",
      },
    ]);
    const url = new URL(begun.authorize_url);
    expect(url.origin + url.pathname).toBe(`${s.fake.origin}/auth/v1/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: "code", client_id: "client-1", redirect_uri: "http://127.0.0.1:8976/callback", scope: "openid offline_access", code_challenge_method: "S256" });
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
    const pending = JSON.parse(await readFile(join(s.stateDir, "pending.json"), "utf8"));
    expect(createHash("sha256").update(pending.verifier).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
    expect((await stat(join(s.stateDir, "pending.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(s.stateDir, "client.json"))).mode & 0o777).toBe(0o600);
  });

  it("reuses the registered client, with a new state each time", async () => {
    const s = await setup();
    const first = await s.call("begin_authorization");
    const second = await s.call("begin_authorization");
    expect(s.fake.registrations).toHaveLength(1);
    expect(new URL(first.authorize_url).searchParams.get("state")).not.toBe(new URL(second.authorize_url).searchParams.get("state"));
  });
});

describe("complete_authorization", () => {
  it("checks the state before spending the code, then stores the grant and tells only when it ends", async () => {
    const s = await setup();
    const flow = await s.signIn();
    const wrong = await s.call("complete_authorization", { redirect_url: flow.landed.replace(/state=[^&]+/, "state=somebody-elses") });
    expect(wrong.error).toMatchObject({ kind: "authorization", message: expect.stringContaining("another sign-in") });
    expect(s.fake.tokenRequests).toHaveLength(0);

    const done = await flow.done();
    expect(done).toMatchObject({ ok: true, access_expires_at: "2027-01-15T09:00:00.000Z", refreshable: true, upstream_tools: 4 });
    expect(done.__raw).not.toContain("access-1");
    expect(done.__raw).not.toContain("refresh-1");
    const grant = JSON.parse(await readFile(join(s.stateDir, "grant.json"), "utf8"));
    expect(grant).toMatchObject({ access_token: "access-1", refresh_token: "refresh-1", expires_at_epoch: 1_800_003_600 });
    expect((await stat(join(s.stateDir, "grant.json"))).mode & 0o777).toBe(0o600);
    expect(s.fake.tokenRequests[0]?.get("grant_type")).toBe("authorization_code");
    expect(s.fake.tokenRequests[0]?.get("client_id")).toBe("client-1");

    // The sign-in is spent: the same address cannot be used twice.
    expect((await flow.done()).error).toMatchObject({ kind: "authorization", message: expect.stringContaining("no sign-in is open") });
  });

  it("answers a refusal at Mobbin's page, a stale sign-in and a bare code with what to do next", async () => {
    const s = await setup();
    const flow = await s.signIn();
    expect((await s.call("complete_authorization", { redirect_url: `${flow.begun.redirect_uri}?error=access_denied&error_description=nope` })).error).toMatchObject({ kind: "authorization", message: expect.stringContaining("access_denied") });
    expect((await s.call("complete_authorization", { redirect_url: "not an address" })).error).toMatchObject({ kind: "input" });
    expect((await s.call("complete_authorization", {})).error).toMatchObject({ kind: "input" });
    s.clock.t += 601;
    expect((await flow.done()).error).toMatchObject({ kind: "authorization", message: expect.stringContaining("ten minutes") });
    // A code alone works for a sign-in still open: the verifier binds it.
    const again = await s.signIn();
    expect(await s.call("complete_authorization", { code: again.code })).toMatchObject({ ok: true });
  });

  it("refuses a grant that came without a refresh token, which would end within the hour", async () => {
    const s = await setup();
    s.fake.behaviour.omitRefreshToken = true;
    const flow = await s.signIn();
    const done = await flow.done();
    expect(done.error).toMatchObject({ kind: "authorization", message: expect.stringContaining("no refresh token") });
    expect(await s.call("health")).toMatchObject({ ok: false, grant: { present: false } });
  });
});

describe("Mobbin's tools", () => {
  it("forwards a call with the access token and returns Mobbin's answer as it is", async () => {
    const s = await setup();
    await (await s.signIn()).done();
    const answer = await s.call("search_screens", { query: "onboarding", mode: "deep" });
    expect(answer).toMatchObject({ screens: ["onboarding (deep)"] });
    expect(s.fake.calls).toEqual([{ name: "search_screens", args: { query: "onboarding", mode: "deep" } }]);
    expect(s.fake.callTokens).toEqual(["access-1"]);
    const failed = await s.connect().then((c) => c.callTool({ name: "search_flows", arguments: { query: "boom" } }));
    expect(failed.isError).toBe(true);
  });

  it("offers only what is classified: an upstream tool nobody classified is hidden and health names it", async () => {
    const s = await setup();
    await (await s.signIn()).done();
    const client = await s.connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["begin_authorization", "complete_authorization", "health", "search_flows", "search_screens", "search_sections"]);
    expect(await s.call("health")).toMatchObject({ tools: { exposed: ["search_flows", "search_screens", "search_sections"], hidden: ["delete_everything"], missing: [] } });
    const refused = await client.callTool({ name: "delete_everything", arguments: {} }).catch((e: unknown) => e);
    expect(String(refused)).toMatch(/not found/i);
  });

  it("lists each tool with the description and input schema Mobbin published, once it has listed them", async () => {
    const s = await setup();
    const before = (await (await s.connect()).listTools()).tools.find((t) => t.name === "search_screens");
    expect(before?.description).toContain("forwarded as it is");
    await (await s.signIn()).done();
    const after = (await (await s.connect()).listTools()).tools.find((t) => t.name === "search_screens");
    expect(after?.description).toContain("Find screens in Mobbin's library.");
    expect(after?.inputSchema).toMatchObject({ type: "object", properties: { query: { type: "string", description: "What to look for" }, mode: { enum: ["standard", "deep"] } }, required: ["query"] });
    // The list survives a restart: it is read from the state directory.
    const restarted = await buildDeps({}, { config: { upstreamUrl: s.fake.mcpUrl }, stateDir: s.stateDir });
    expect(restarted.knownTools().map((t) => t.name).sort()).toEqual(["delete_everything", "search_flows", "search_screens", "search_sections"]);
  });

  it("says to sign in when there is no grant", async () => {
    const s = await setup();
    const answer = await s.call("search_screens", { query: "x" });
    expect(answer.error).toMatchObject({ kind: "not_authorized", remedy: expect.stringContaining("begin_authorization") });
    expect(s.fake.calls).toEqual([]);
  });
});

describe("refresh", () => {
  it("refreshes a token near expiry, and has the new pair on disk before the new token is used", async () => {
    const s = await setup();
    await (await s.signIn()).done();
    s.clock.t += 3_600 - 30;
    const onDisk: string[] = [];
    s.fake.behaviour.onMcp = async (token) => {
      if (token === "access-2") onDisk.push(JSON.parse(await readFile(join(s.stateDir, "grant.json"), "utf8")).refresh_token);
    };
    expect(await s.call("search_screens", { query: "x" })).toMatchObject({ screens: ["x (standard)"] });
    expect(onDisk[0]).toBe("refresh-2");
    expect(s.fake.tokenRequests.map((r) => [r.get("grant_type"), r.get("refresh_token")])).toEqual([
      ["authorization_code", null],
      ["refresh_token", "refresh-1"],
    ]);
    expect(s.fake.callTokens).toEqual(["access-2"]);
  });

  it("shares one refresh between concurrent calls, so a refresh token is never spent twice", async () => {
    const s = await setup();
    await (await s.signIn()).done();
    s.clock.t += 3_600;
    s.fake.behaviour.refreshDelayMs = 50;
    const answers = await Promise.all([1, 2, 3, 4, 5].map((n) => s.call("search_screens", { query: `q${String(n)}` })));
    expect(answers.every((a) => a.screens !== undefined)).toBe(true);
    expect(s.fake.tokenRequests.filter((r) => r.get("grant_type") === "refresh_token")).toHaveLength(1);
    expect(new Set(s.fake.callTokens)).toEqual(new Set(["access-2"]));
  });

  it("refreshes once and retries when Mobbin refuses a token that still looks good", async () => {
    const s = await setup();
    await (await s.signIn()).done();
    s.fake.validAccess.delete("access-1");
    expect(await s.call("search_screens", { query: "y" })).toMatchObject({ screens: ["y (standard)"] });
    expect(s.fake.callTokens).toEqual(["access-2"]);
  });

  it("answers not_authorized with the way back when the refresh token is refused, and forgets the dead grant", async () => {
    const s = await setup();
    await (await s.signIn()).done();
    s.clock.t += 3_600;
    s.fake.behaviour.refuseRefresh = true;
    const first = await s.call("search_screens", { query: "z" });
    expect(first.error).toMatchObject({ kind: "not_authorized", message: expect.stringContaining("invalid_grant"), remedy: expect.stringContaining("begin_authorization") });
    expect(first.__raw).not.toContain("refresh-1");
    const second = await s.call("search_screens", { query: "z" });
    expect(second.error).toMatchObject({ kind: "not_authorized", message: expect.stringContaining("no Mobbin account") });
    expect(s.fake.tokenRequests.filter((r) => r.get("grant_type") === "refresh_token")).toHaveLength(1);
    // Signing in again brings it back.
    s.fake.behaviour.refuseRefresh = false;
    await (await s.signIn()).done();
    expect(await s.call("search_screens", { query: "z" })).toMatchObject({ screens: ["z (standard)"] });
  });
});

describe("health", () => {
  it("says what is missing when there is no grant, and never prints a token", async () => {
    const s = await setup();
    const h = await s.call("health");
    expect(h).toMatchObject({ ok: false, grant: { present: false }, client_registered: false, next: expect.stringContaining("begin_authorization") });
  });

  it("reports the grant, a refresh that worked, Mobbin's tools and the classified ones it no longer lists", async () => {
    const s = await setup();
    await (await s.signIn()).done();
    const quiet = await s.call("health");
    expect(quiet).toMatchObject({ ok: true, grant: { present: true, access_expires_in_seconds: 3600 }, refresh: expect.stringContaining("not needed"), upstream_reachable: true, upstream_tool_count: 4 });
    const tried = await s.call("health", { test_refresh: true });
    expect(tried).toMatchObject({ ok: true, refresh: "worked" });
    for (const secret of ["access-1", "access-2", "refresh-1", "refresh-2"]) {
      expect(quiet.__raw).not.toContain(secret);
      expect(tried.__raw).not.toContain(secret);
    }
    s.fake.behaviour.refuseRefresh = true;
    const broken = await s.call("health", { test_refresh: true });
    expect(broken).toMatchObject({ ok: false, refresh: { failed: { kind: "not_authorized" } }, next: expect.stringContaining("begin_authorization") });
  });
});
