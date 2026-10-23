/**
 * PORKBUN_TOOLSETS: unset or `all` serves what the server always served (the
 * snapshot in tools.test.ts, and the vendor's instructions word for word); a
 * subset registers only its tools and the instructions say what is missing;
 * an unknown name stops the start. The table in src/mcp/toolsets.ts must name
 * every tool the pinned package offers, and nothing else. No credential is
 * real and nothing leaves the process: fetch is stubbed.
 */
import { ACCESS_META, checkPolicy, connectInMemory, guard, McpServer, type ToolPolicy } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDeps } from "../src/composition.js";
import { VENDOR_INSTRUCTION_PARTS, VENDOR_INSTRUCTIONS } from "../src/infra/vendor.js";
import { instructionsFor } from "../src/mcp/instructions.js";
import { policyFor } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { ALWAYS, loadToolsets, TOOLSET_NAMES, TOOLSET_OF, toolsetGaps, toolsOf } from "../src/mcp/toolsets.js";
import { FIXED_ENV } from "./fixedEnv.js";
import { connect, json, keyFiles, stubFetch } from "./harness.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const deps = buildDeps(FIXED_ENV);
const FULL: ToolPolicy = policyFor(deps.porkbun.catalog);
const OFFERED = Object.keys(FULL);

/** The server as index.ts builds it with PORKBUN_TOOLSETS set to `toolsets`, and a client of it. */
const serverWith = async (toolsets: string | undefined) => {
  const { loaded, policy } = loadToolsets(FULL, toolsets === undefined ? {} : { PORKBUN_TOOLSETS: toolsets });
  const server = new McpServer({ name: "porkbun", version: "test" }, { instructions: instructionsFor(loaded) });
  registerAll(guard(server, { service: "porkbun", policy, log: () => undefined }), deps, policy);
  const client = await connectInMemory(server);
  return { client, policy, loaded, names: (await client.listTools()).tools.map((tool) => tool.name) };
};

/** The tool names a text mentions: snake_case words. */
const toolNamesIn = (text: string): readonly string[] => [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];

const sorted = (names: Iterable<string>): readonly string[] => [...new Set(names)].sort();

describe("the table against the pinned package", () => {
  it("places every tool offered, and names no tool that is not", () => {
    // A pin that adds a tool, or drops one, fails here (and stops the server at start) until a person places it.
    expect(toolsetGaps(OFFERED)).toEqual([]);
    expect(OFFERED).toHaveLength(113);
  });

  it("fails on a tool in no toolset, a tool no longer offered, and a tool placed twice", () => {
    expect(toolsetGaps([...OFFERED, "buy_everything"])).toEqual(["offered but in no toolset (place them in src/mcp/toolsets.ts): buy_everything"]);
    expect(toolsetGaps(OFFERED.filter((tool) => tool !== "register_domain" && tool !== "ping"))).toEqual(["in a toolset but not offered (drop them): ping, register_domain"]);
    expect(() => loadToolsets({ ...FULL, buy_everything: { access: "read" } }, {})).toThrow(
      "porkbun: src/mcp/toolsets.ts does not fit the tools offered; offered but in no toolset (place them in src/mcp/toolsets.ts): buy_everything",
    );
  });

  it("loads ping, get_balance and get_api_settings whatever is named, and gives every other tool a toolset", () => {
    expect(ALWAYS).toEqual(["ping", "get_balance", "get_api_settings"]);
    expect(sorted([...ALWAYS, ...Object.keys(TOOLSET_OF)])).toEqual(sorted(OFFERED));
    for (const toolset of TOOLSET_NAMES) expect(toolsOf(toolset).length, toolset).toBeGreaterThan(0);
  });

  it("splits the vendor's instructions where they turn to publishing a site, which names only hosting tools", () => {
    expect(`${VENDOR_INSTRUCTION_PARTS.general} ${VENDOR_INSTRUCTION_PARTS.website}`).toBe(VENDOR_INSTRUCTIONS);
    expect(toolNamesIn(VENDOR_INSTRUCTION_PARTS.general)).toEqual([]);
    expect(toolNamesIn(VENDOR_INSTRUCTION_PARTS.website).filter((tool) => !toolsOf("hosting").includes(tool))).toEqual([]);
  });
});

describe("PORKBUN_TOOLSETS unset or all", () => {
  it("loads every toolset", () => {
    for (const value of [undefined, "", " , ", "all", "dns,all"]) {
      expect(loadToolsets(FULL, value === undefined ? {} : { PORKBUN_TOOLSETS: value }).loaded, String(value)).toEqual(TOOLSET_NAMES);
    }
  });

  it("serves every tool with the rule it always had, and the vendor's instructions word for word", async () => {
    const { names, policy, loaded } = await serverWith(undefined);
    expect(names).toEqual(sorted(OFFERED));
    expect(sorted(Object.keys(policy))).toEqual(sorted(OFFERED));
    for (const tool of OFFERED) expect(policy[tool], tool).toBe(FULL[tool]);
    expect(instructionsFor(loaded)).toBe(VENDOR_INSTRUCTIONS);
  });
});

describe("an unknown toolset", () => {
  it("stops the start, naming the toolsets there are", () => {
    expect(() => loadToolsets(FULL, { PORKBUN_TOOLSETS: "dns,dsn" })).toThrow(
      'PORKBUN_TOOLSETS names "dsn", which is not a toolset: the toolsets are domains, dns, dnssec, glue, forwards, hosting, mailboxes, cloudflare, transfers, marketplace, webhooks, account, docs, or all (the default)',
    );
  });
});

describe("one toolset at a time", () => {
  it("registers exactly the tools always loaded and that toolset's, each with its one rule", () => {
    for (const toolset of TOOLSET_NAMES) {
      const { loaded, policy } = loadToolsets(FULL, { PORKBUN_TOOLSETS: toolset });
      expect(loaded).toEqual([toolset]);
      expect(sorted(Object.keys(policy)), toolset).toEqual(sorted([...ALWAYS, ...toolsOf(toolset)]));
      for (const [tool, rule] of Object.entries(policy)) expect(rule, tool).toBe(FULL[tool]);
      // serve() refuses to start when what is registered is not what the policy names.
      expect(() => checkPolicy("porkbun", (server) => registerAll(server, deps, policy), policy), toolset).not.toThrow();
    }
  });
});

describe("PORKBUN_TOOLSETS=dns,forwards", () => {
  it("lists only those tools and the three always there, and a tool of another toolset does not exist", async () => {
    const { client, names } = await serverWith("forwards, dns");
    expect(names).toEqual(sorted([...ALWAYS, ...toolsOf("dns"), ...toolsOf("forwards")]));
    expect(names).toContain("create_url_forward");
    expect(names).not.toContain("register_domain");
    expect(names).not.toContain("deploy_site");
    await expect(client.callTool({ name: "register_domain", arguments: { domain: "example.com", cost_cents: 1108 } })).rejects.toThrow("Tool register_domain not found");
  });

  it("tells the client what is loaded and what is not, and names no tool it was not handed", async () => {
    const { client, names } = await serverWith("dns,forwards");
    const instructions = client.getInstructions() ?? "";
    expect(instructions.startsWith(VENDOR_INSTRUCTION_PARTS.general)).toBe(true);
    expect(instructions).not.toContain("Building a website");
    expect(instructions).toContain("only the Porkbun toolsets dns, forwards (PORKBUN_TOOLSETS), with ping, get_balance, get_api_settings always there");
    expect(instructions).toContain("The tools of domains, dnssec, glue, hosting, mailboxes, cloudflare, transfers, marketplace, webhooks, account, docs are not on this server");
    expect(toolNamesIn(instructions).filter((tool) => !names.includes(tool))).toEqual([]);
  });
});

describe("PORKBUN_TOOLSETS=hosting", () => {
  it("keeps the vendor's paragraph on publishing a site", async () => {
    const { client, names } = await serverWith("hosting");
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain(VENDOR_INSTRUCTION_PARTS.website);
    expect(toolNamesIn(instructions).filter((tool) => !names.includes(tool))).toEqual([]);
  });
});

describe("money in a subset", () => {
  const caps = (remaining: number) => ({
    status: "SUCCESS",
    spendLimit: { limit: 10000, source: "default", spent: 10000 - remaining, remaining },
    topupLimit: { limit: 10000, source: "default", added: 0 },
  });

  it("is still marked money and confirmed with the user, line for line", async () => {
    const sent = stubFetch((url) => json(url.endsWith("/account/apiSettings") ? caps(10000) : { status: "SUCCESS", domain: "example.net" }));
    const { client, call, asked } = await connect({ ...keyFiles(), PORKBUN_TOOLSETS: "marketplace" });
    const listed = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    expect(listed.get("buy_closeout")?._meta?.[ACCESS_META]).toBe("money");
    expect(listed.has("top_up_account_credit")).toBe(false);

    await call("buy_closeout", { domain: "example.net", cost_cents: 2400 });
    expect(asked).toEqual(["porkbun: buy the closeout example.net for $24.00 from Porkbun account credit"]);
    // The cap is read first, through the port, then the purchase is sent.
    expect(sent.map((s) => s.url.endsWith("/account/apiSettings"))).toEqual([true, false]);
    expect(sent[1]).toMatchObject({ method: "POST", body: expect.objectContaining({ cost: 2400 }) });
  });

  it("is refused over the monthly cap before anything is sent, whichever toolsets are loaded", async () => {
    const sent = stubFetch(() => json(caps(500)));
    const { call } = await connect({ ...keyFiles(), PORKBUN_TOOLSETS: "domains" });
    const result = await call("register_domain", { domain: "example.org", cost_cents: 1108 });
    expect(result.value).toMatchObject({ error: { kind: "over_limit", code: "MONTHLY_SPEND_LIMIT_EXCEEDED" } });
    expect(sent.map((s) => new URL(s.url).pathname)).toEqual(["/api/json/v3/account/apiSettings"]);
  });
});
