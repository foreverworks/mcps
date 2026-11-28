/**
 * TRADEMARKS_TOOLSETS: unset serves every tool as before; `search` is the
 * server for anyone with no key: search_marks, get_mark and health, with no
 * case-file source. An office with no source says it was not searched, and why.
 * No credential is real and no request leaves the process: fetch is stubbed.
 */
import { connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { instructionsFor } from "../src/mcp/instructions.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { loadToolsets, TOOLSET_NAMES, toolsetGaps } from "../src/mcp/toolsets.js";
import { usptoAnswer, usptoDetail } from "./fixtures.js";
import { noSleep, stubFetch } from "./stubFetch.js";

/** The server as index.ts builds it with `env`, against a USPTO that answers from the fixtures, and a client of it. */
const connect = async (env: NodeJS.ProcessEnv) => {
  const stub = stubFetch((asked) => (asked.url.includes("/tmsearch/") || asked.url.endsWith("/tmsearch") ? { json: usptoAnswer() } : { json: usptoDetail }));
  const { loaded, policy } = loadToolsets(POLICY, env);
  const deps = buildDeps(env, { fetch: stub.fetch, sleep: noSleep, random: () => 0 });
  const server = new McpServer({ name: "trademarks", version: "test" }, { instructions: instructionsFor(loaded) });
  registerAll(guard(server, { service: "trademarks", policy, log: () => undefined }), deps, policy);
  const client = await connectInMemory(server);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: result.isError, answer: JSON.parse(result.content[0]?.text ?? "null") as Record<string, any> };
  };
  return { client, call, deps, policy, asked: stub.asked, names: (await client.listTools()).tools.map((tool) => tool.name) };
};

describe("the table against the tools offered", () => {
  it("places every tool, and names none that is not offered", () => {
    expect(toolsetGaps(Object.keys(POLICY))).toEqual([]);
    expect(toolsetGaps([...Object.keys(POLICY), "register_mark"])).toEqual(["offered but in no toolset (place them in src/mcp/toolsets.ts): register_mark"]);
    expect(toolsetGaps(Object.keys(POLICY).filter((tool) => tool !== "get_mark"))).toEqual(["in a toolset but not offered (drop them): get_mark"]);
    expect(TOOLSET_NAMES).toEqual(["search", "records"]);
  });

  it("refuses a name that is not a toolset", () => {
    expect(() => loadToolsets(POLICY, { TRADEMARKS_TOOLSETS: "search,filing" })).toThrow('TRADEMARKS_TOOLSETS names "filing", which is not a toolset: the toolsets are search, records, or all (the default)');
  });
});

describe("with the variable unset, as every deployment runs", () => {
  it("registers every tool, and tells a client the whole story", async () => {
    for (const env of [{}, { TRADEMARKS_TOOLSETS: "all" }]) {
      const { names, deps } = await connect(env);
      expect(names.toSorted()).toEqual(Object.keys(POLICY).toSorted());
      expect(deps.records.map((r) => r.source)).toEqual(["uspto-tsdr"]);
    }
    expect(instructionsFor([...TOOLSET_NAMES])).toContain("get_mark, mark_history and mark_documents read one mark in depth");
  });
});

describe("search: the server for anyone, with no key", () => {
  const env = { TRADEMARKS_TOOLSETS: "search" };

  it("registers search_marks, get_mark and health, and nothing that needs a TSDR key", async () => {
    const { names, deps, policy } = await connect(env);
    expect(names.toSorted()).toEqual(["get_mark", "health", "search_marks"]);
    expect(Object.values(policy).every((rule) => rule.access === "read")).toBe(true);
    expect(deps.records).toEqual([]);
    expect(instructionsFor(loadToolsets(POLICY, env).loaded)).not.toMatch(/mark_history|mark_documents/);
  });

  it("gives every tool a title and a read-only hint a directory reviews", async () => {
    const { client } = await connect(env);
    for (const tool of (await client.listTools()).tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("searches the US with no credentials, and says plainly that the EU was not searched, and why", async () => {
    const { call } = await connect(env);
    const searched = await call("search_marks", { name: "Turnip" });
    expect(searched.isError).toBeUndefined();
    const sections = Object.fromEntries((searched.answer["offices"] as { office: string }[]).map((s) => [s.office, s]));
    expect(sections["US"]).toMatchObject({ searched: true, found: 42 });
    expect(sections["EM"]).toMatchObject({ searched: false, error: { kind: "config", message: expect.stringContaining("EUIPO's API is not configured") } });
    expect(sections["RO"]).toMatchObject({ searched: false });
    expect(sections["WO"]).toMatchObject({ searched: false });
  });

  it("reads a US mark with no credentials", async () => {
    const { call } = await connect(env);
    const mark = await call("get_mark", { office: "US", id: "90000001" });
    expect(mark.isError).toBeUndefined();
    expect(mark.answer).toMatchObject({ source: "uspto-tmsearch" });
  });

  it("with the EU source left out too, names the EU as not searched with where to look", async () => {
    const { call } = await connect({ ...env, TRADEMARKS_SOURCES: "uspto" });
    const searched = await call("search_marks", { name: "Turnip", offices: ["US", "EM"] });
    const health = await call("health");
    const em = (searched.answer["offices"] as { office: string; searched: boolean; reason?: string }[]).find((s) => s.office === "EM");
    expect(em).toMatchObject({ searched: false, reason: expect.stringContaining("https://euipo.europa.eu/eSearch") });
    expect(health.answer).toMatchObject({ ok: true, records: [], sources: [{ office: "US", state: "ok" }] });
    expect(health.answer["uncovered"]).toEqual(expect.arrayContaining([expect.objectContaining({ office: "EM" })]));
  });

  it("answers health for the sources it has, not for a key it was never given", async () => {
    const { call } = await connect(env);
    const health = await call("health");
    expect(health.isError).toBeUndefined();
    expect(health.answer["records"]).toEqual([]);
  });
});
