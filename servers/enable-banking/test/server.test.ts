/**
 * The server as a client sees it, through the kit's guard: every tool is
 * classified, a consent is confirmed with the user (MCP_CONFIRM=elicit) with a
 * summary computed from the arguments as the tool will run them, and the
 * arguments keep their names. A temp dir per test and a stubbed fetch.
 */
import { checkPolicy, confirmingClient, connectInMemory, guard, type GuardSettings, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it, vi } from "vitest";

import { buildDeps } from "../src/composition.js";
import { consentValidUntil } from "../src/domain/dates.js";
import { POLICY, startAuthSummary } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { sessionResponse } from "./fixtures.js";
import { json, routeFetch, testEnv } from "./support.js";

const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

/** The server through the guard; the client confirms what `answer` says and records every line it was shown. */
const connect = async (settings: GuardSettings, answer: (line: string) => boolean = () => true) => {
  const deps = buildDeps(testEnv());
  const server = new McpServer({ name: "enable-banking", version: "test" });
  registerAll(guard(server, { service: "enable-banking", policy: POLICY, settings, log: () => undefined }), deps);
  const { client, asked } = confirmingClient("test", answer);
  await connectInMemory(server, client);
  return { client, asked };
};

const CONFIRMING: GuardSettings = { maxAccess: "money", confirm: "elicit" };
const START = { aspsp_name: "Example Bank", aspsp_country: "DE", psu_type: "personal" };

describe("the policy", () => {
  it("classifies exactly the tools the server registers", () => {
    const deps = buildDeps(testEnv());
    expect(() => checkPolicy("enable-banking", (server) => registerAll(server, deps), POLICY)).not.toThrow();
    expect(Object.fromEntries(Object.entries(POLICY).map(([tool, rule]) => [tool, rule.access]))).toEqual({
      health: "read",
      list_aspsps: "read",
      list_stored_sessions: "read",
      list_accounts: "read",
      get_transactions: "read",
      get_balances: "read",
      export_transactions: "read",
      complete_auth: "write",
      revoke_session: "write",
      start_auth: "money",
    });
  });

  it("summarises a consent in one line: bank, country, PSU type and the end date asked for", () => {
    const now = Date.UTC(2030, 0, 2, 12, 0, 0);
    expect(startAuthSummary(() => now)({ aspsp_name: "Example Bank", aspsp_country: "DE", psu_type: "personal" })).toBe(
      "Bank consent (PSD2, read-only: balances and transactions) with Example Bank (DE), personal accounts, " +
        "every account the bank offers, valid 180 days: until 2030-07-01 if confirmed today",
    );
    expect(startAuthSummary(() => now)({ aspsp_name: "BRD", aspsp_country: "ro", psu_type: "personal" })).toContain(
      "with BRD (RO), personal accounts",
    );
    expect(consentValidUntil(now).slice(0, 10)).toBe("2030-07-01");
    expect(startAuthSummary(() => now)({ aspsp_name: "Example Bank", aspsp_country: "Germany", psu_type: "business" })).toMatch(
      /do not validate; it will be refused/,
    );
    expect(startAuthSummary(() => now)({})).toMatch(/do not validate; it will be refused/);
  });
});

describe("through the guard", () => {
  it("asks the user before a consent, with the line computed from the call's own arguments", async () => {
    const { client, asked } = await connect(CONFIRMING);
    const spy = routeFetch({ "POST /auth": () => json({ url: "https://bank.test/sca", authorization_id: "a1", psu_id_hash: "h" }) });
    const out = parse(await client.callTool({ name: "start_auth", arguments: START }));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^enable-banking: Bank consent .* with Example Bank \(DE\), personal accounts, .* valid 180 days: until \d{4}-\d{2}-\d{2} if confirmed today$/);
    expect(out).toMatchObject({ ok: true, url: "https://bank.test/sca" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("starts no consent the user declined", async () => {
    const { client } = await connect(CONFIRMING, () => false);
    const spy = routeFetch({});
    const result = await client.callTool({ name: "start_auth", arguments: START });
    expect(result.isError).toBe(true);
    expect(parse(result).error.kind).toBe("confirmation_denied");
    expect(spy).not.toHaveBeenCalled();
  });

  it("starts no consent on a server capped below money", async () => {
    const { client, asked } = await connect({ maxAccess: "write", confirm: "client" });
    const spy = routeFetch({});
    expect(parse(await client.callTool({ name: "start_auth", arguments: START })).error.kind).toBe("access_denied");
    expect(asked).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("completes a consent from a bare code under the label derived from its bank, with nothing to confirm", async () => {
    const { client, asked } = await connect(CONFIRMING);
    routeFetch({
      "POST /sessions": () => json(sessionResponse({ accounts: [] })),
    });
    const out = parse(await client.callTool({ name: "complete_auth", arguments: { code_or_url: "c0de" } }));
    expect(out).toMatchObject({ ok: true, storedAs: "example_bank_de", count: 0 });
    expect(asked).toEqual([]);
    const listed = parse(await client.callTool({ name: "list_stored_sessions", arguments: {} }));
    expect(listed.sessions[0]).toMatchObject({ label: "example_bank_de", expires: expect.stringMatching(/^expires 2030-07-01/) });
  });

  it("answers a failure with isError and a remedy", async () => {
    const { client } = await connect(CONFIRMING);
    const result = await client.callTool({ name: "list_accounts", arguments: {} });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toMatchObject({ kind: "not_found", remedy: expect.any(String) });
  });

  it("refuses arguments the schema does not allow before any request", async () => {
    const { client } = await connect(CONFIRMING);
    const spy = routeFetch({});
    const result = await client.callTool({ name: "start_auth", arguments: { ...START, aspsp_country: "Germany" } });
    expect(result.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
