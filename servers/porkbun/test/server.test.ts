import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { LIVE_KEY_PROFILE, VENDOR_PROFILES, VENDOR_TOOLS } from "../src/infra/vendor.js";
import { LEFT_OUT } from "../src/infra/vendor/offer.js";
import { OWN_TOOLS } from "../src/mcp/register.js";
import { ACCESS_META } from "@foreverworks/mcp-kit";

import { FAKE_KEY, FAKE_SECRET, connect, json, keyFiles, stubFetch } from "./harness.js";

const API = "https://api.porkbun.com/api/json/v3";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tools on offer", () => {
  it("are the vendor's own, less the sandbox tools its live-key profile leaves out and the ones this server does not offer, and money ones say so", async () => {
    const { client } = await connect(keyFiles());
    const listed = (await client.listTools()).tools;
    const liveExcluded = VENDOR_PROFILES.find((p) => p.path === LIVE_KEY_PROFILE)?.exclude ?? new Set<string>();
    expect(listed.map((t) => t.name)).toEqual(
      VENDOR_TOOLS.map((t) => t.name)
        .filter((name) => !liveExcluded.has(name) && !Object.hasOwn(LEFT_OUT, name))
        .concat(OWN_TOOLS.map((t) => t.name))
        .sort(),
    );
    expect(Object.keys(LEFT_OUT).sort()).toEqual(["get_usdc_topup_status", "request_api_key", "retrieve_api_key", "top_up_with_usdc"]);
    expect(liveExcluded).toEqual(new Set(["create_sandbox_key", "sandbox_topup", "sandbox_reset", "sandbox_trigger_webhook"]));

    const byName = new Map(listed.map((t) => [t.name, t]));
    expect(byName.get("register_domain")?._meta?.[ACCESS_META]).toBe("money");
    expect(byName.get("register_domain")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get("list_domains")?._meta?.[ACCESS_META]).toBe("read");
    expect(byName.get("list_domains")?.annotations?.readOnlyHint).toBe(true);
  });

  it("say where a secret is withheld, and only on tools that are not money", async () => {
    const { client } = await connect(keyFiles());
    const describe = new Map((await client.listTools()).tools.map((t) => [t.name, t.description ?? ""]));
    expect(describe.get("get_webhook")).toContain("a secret field in the result is withheld");
    expect(describe.get("get_webhook")).toMatch(/^[^.]*\(its secret is withheld on this server\)\./);
    expect(describe.get("list_webhooks")).toContain("a secret field in the result is withheld");
    expect(describe.get("create_webhook")).not.toContain("withheld");
    expect(describe.get("list_domains")).not.toContain("withheld");
  });
});

describe("a read", () => {
  it("goes to api.porkbun.com with the key pair from the files, and comes back as compact JSON", async () => {
    const body = { status: "SUCCESS", domains: [{ domain: "example.com", autoRenew: 1 }] };
    const sent = stubFetch(() => json(body));
    const { call, audit } = await connect(keyFiles());

    const result = await call("list_domains", { tlds: ["com"] });

    expect(result).toEqual({ isError: false, text: JSON.stringify(body), value: body });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: `${API}/domain/listAll?tlds%5B%5D=com`, method: "GET" });
    expect(sent[0]?.headers).toMatchObject({ "X-API-Key": FAKE_KEY, "X-Secret-API-Key": FAKE_SECRET, "User-Agent": expect.stringMatching(/^porkbun-mcp\/\d+\.\d+\.\d+$/) });
    expect(audit.map((line) => JSON.parse(line.replace(/^audit /, "")) as unknown)).toEqual([
      { svc: "porkbun", tool: "list_domains", client: "stdio", account: null, access: "read", outcome: "ok", ms: expect.any(Number) },
    ]);
  });

  it("prefers the key files to the plain variables", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect({ ...keyFiles(), PORKBUN_API_KEY: "pk1_from_env", PORKBUN_SECRET_API_KEY: "sk1_from_env" });
    await call("get_balance");
    expect(sent[0]?.headers).toMatchObject({ "X-API-Key": FAKE_KEY, "X-Secret-API-Key": FAKE_SECRET });
  });

  it("takes the plain variables for a local stdio run", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect({ PORKBUN_API_KEY: "pk1_from_env", PORKBUN_SECRET_API_KEY: "sk1_from_env" });
    await call("get_balance");
    expect(sent[0]?.headers).toMatchObject({ "X-API-Key": "pk1_from_env", "X-Secret-API-Key": "sk1_from_env" });
  });
});

describe("failures", () => {
  it("Porkbun's refusal is `api` with its code and a remedy", async () => {
    stubFetch(() => json({ status: "ERROR", code: "DOMAIN_NOT_FOUND", message: "Domain is not in this account." }, 404));
    const { call, audit } = await connect(keyFiles());
    const result = await call("get_domain", { domain: "Example.COM" });
    expect(result.isError).toBe(true);
    expect(result.value).toEqual({
      error: { kind: "api", code: "DOMAIN_NOT_FOUND", message: "Porkbun API error [DOMAIN_NOT_FOUND]: Domain is not in this account.", remedy: expect.any(String) },
    });
    expect(audit[0]).toContain('"outcome":"api"');
  });

  it("no key pair: the documentation tools still work, and an API tool answers `config` without sending anything", async () => {
    const sent = stubFetch((url) => (url.startsWith("https://porkbun.com/llms") ? new Response("# Porkbun docs") : json({ status: "SUCCESS" })));
    const { call } = await connect({});
    expect((await call("list_doc_topics")).value).toMatchObject({ topic: "index", content: "# Porkbun docs" });
    const refused = await call("list_domains");
    expect(refused.value).toMatchObject({ error: { kind: "config", remedy: expect.stringContaining("PORKBUN_API_KEY_FILE") } });
    expect(sent.map((s) => s.url)).toEqual(["https://porkbun.com/llms"]);
  });

  it("a key file that cannot be read is `config`, naming the variable and never a key", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect({ ...keyFiles(), PORKBUN_SECRET_API_KEY_FILE: "/nonexistent/secret-api-key" });
    const result = await call("ping");
    expect(result.value).toMatchObject({ error: { kind: "config", message: expect.stringContaining("PORKBUN_SECRET_API_KEY_FILE names /nonexistent/secret-api-key") } });
    expect(result.text).not.toContain(FAKE_KEY);
    expect(sent).toEqual([]);
  });

  it("an unreachable Porkbun is `network`, a host the process may not reach is `egress`", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } })));
    const { call } = await connect(keyFiles());
    expect((await call("ping")).value).toMatchObject({ error: { kind: "network" } });

    stubFetch(() => Promise.reject(Object.assign(new TypeError("egress to api.porkbun.com is not allowed"), { cause: { code: "EGRESS_DENIED" } })));
    expect((await call("ping")).value).toMatchObject({ error: { kind: "egress", remedy: expect.stringContaining("MCP_EGRESS_ALLOW") } });
  });
});

describe("money", () => {
  it("confirms the exact purchase with the user first, then runs exactly that", async () => {
    const caps = { status: "SUCCESS", spendLimit: { limit: 10000, source: "default", spent: 0, remaining: 10000 }, topupLimit: { limit: 10000, source: "default", added: 0 } };
    const sent = stubFetch((url) => json(url.endsWith("/account/apiSettings") ? caps : { status: "SUCCESS", domain: "example.com" }));
    const { call, audit, asked } = await connect(keyFiles());
    const result = await call("register_domain", { domain: "Example.com", cost_cents: 1108 });
    expect(result.value).toEqual({ status: "SUCCESS", domain: "example.com" });
    expect(asked).toEqual(["porkbun: register example.com for $11.08 from Porkbun account credit"]);
    expect(sent.map((s) => s.url)).toEqual([`${API}/account/apiSettings`, `${API}/domain/create/example.com`]);
    expect(sent[1]).toMatchObject({ method: "POST" });
    expect(sent[1]?.body).toEqual({ cost: 1108, agreeToTerms: "yes", apikey: FAKE_KEY, secretapikey: FAKE_SECRET });
    expect(audit[0]).toContain('"outcome":"asked"');
    expect(audit[1]).toContain('"confirmed":"elicit"');
  });

  it("sends nothing the user declined, or on a server capped below money", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const declined = await connect(keyFiles(), undefined, () => false);
    expect((await declined.call("top_up_account_credit", { amount_cents: 2000 })).value).toMatchObject({ error: { kind: "confirmation_denied" } });
    const capped = await connect(keyFiles(), { maxAccess: "write", confirm: "client" });
    expect((await capped.call("top_up_account_credit", { amount_cents: 2000 })).value).toMatchObject({ error: { kind: "access_denied" } });
    expect(sent).toEqual([]);
  });

  it("a short balance gets the top-up remedy", async () => {
    const caps = { status: "SUCCESS", spendLimit: { limit: null, source: "none", spent: 0, remaining: null }, topupLimit: { limit: null, source: "none", added: 0 } };
    stubFetch((url) => (url.endsWith("/account/apiSettings") ? json(caps) : json({ status: "ERROR", code: "INSUFFICIENT_FUNDS", message: "Shortfall $3.08." }, 402)));
    const { call } = await connect(keyFiles());
    const result = await call("renew_domain", { domain: "example.com", cost_cents: 1108 });
    expect(result.value).toMatchObject({ error: { kind: "api", code: "INSUFFICIENT_FUNDS", remedy: expect.stringContaining("top_up_account_credit") } });
  });

  it("two amounts that disagree are refused by the vendor before anything is sent, and the user was told", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call, asked } = await connect(keyFiles());
    const result = await call("buy_closeout", { domain: "example.com", cost_cents: 1108, cost: 1200 });
    expect(asked[0]).toBe("porkbun: buy the closeout example.com for CONFLICTING cost_cents and cost (the call will be refused) from Porkbun account credit");
    expect(result.value).toMatchObject({ error: { kind: "refused", message: expect.stringContaining("disagree") } });
    expect(sent).toEqual([]);
  });
});

describe("secrets", () => {
  it("are withheld from a result the user did not confirm, and handed out by one they did", async () => {
    const endpoint = { id: 7, url: "https://hooks.example.com/porkbun", secret: "whsec_live_value" };
    stubFetch(() => json({ status: "SUCCESS", endpoints: [endpoint], endpoint }));
    const { call } = await connect(keyFiles());

    const listed = await call("list_webhooks");
    expect(listed.text).not.toContain("whsec_live_value");
    expect(listed.value).toMatchObject({ endpoints: [{ id: 7, secret: expect.stringMatching(/^\[withheld: /) }] });

    const rotated = await call("rotate_webhook_secret", { id: 7 });
    expect(rotated.value).toMatchObject({ endpoint: { secret: "whsec_live_value" } });
  });

  it("the key pair never reaches a result or the audit line", async () => {
    stubFetch(() => json({ status: "SUCCESS", yourIp: "192.0.2.1" }));
    const { call, audit } = await connect(keyFiles());
    const results = [await call("ping"), await call("get_balance"), await call("list_domains")];
    const everything = [...results.map((r) => r.text), ...audit].join("\n");
    expect(everything).not.toContain(FAKE_KEY);
    expect(everything).not.toContain(FAKE_SECRET);
  });
});
