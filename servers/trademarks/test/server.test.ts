/**
 * The server as a client sees it, through the kit's guard, against in-memory
 * registers: no credentials, no network.
 */
import { checkPolicy, connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import type { OutboxPort, RecordsPort, RegisterPort, SourcePage } from "../src/app/ports.js";
import { buildDeps } from "../src/composition.js";
import { configError, fail } from "../src/domain/errors.js";
import type { Mark, MarkDetail } from "../src/domain/mark.js";
import type { SourceQuery } from "../src/domain/query.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

const mark = (id: string, text: string | null, status: Mark["status"], classes: number[]): Mark => ({
  office: "US",
  id,
  mark: text,
  status,
  statusText: status.toUpperCase(),
  owners: [`owner of ${id}`],
  classes,
  link: `https://example.test/${id}`,
});

const US_PAGE: SourcePage = {
  found: 42,
  marks: [
    mark("1", "DURNIP", "registered", [9]),
    mark("2", "TURNIP", "pending", [9, 42]),
    mark("3", "TURNIP QPT", "registered", [9]),
    mark("4", "TURNIP", "registered", [42]),
    mark("5", "TURNIP", "registered", [7, 20]),
    mark("6", "TURNIP", "dead", [35]),
  ],
};

const register = (over: Partial<RegisterPort> & Pick<RegisterPort, "office" | "source">): RegisterPort & { asked: SourceQuery[] } => {
  const asked: SourceQuery[] = [];
  return {
    official: false,
    similarity: "fake",
    goods: over.office === "US",
    search: async (q) => (asked.push(q), US_PAGE),
    get: async (id): Promise<MarkDetail> => ({ ...mark(id, "TURNIP", "registered", [42]), goodsAndServices: [{ class: 42, terms: "SaaS" }] }),
    probe: async () => undefined,
    ...over,
    asked,
  };
};

const fakeOutbox: OutboxPort = { save: async (name, bytes) => ({ path: `/srv/trademarks-outbox/${name}`, sha256: "0".repeat(64), size: bytes.length }) };

const connected = async (registers: readonly RegisterPort[], records: readonly RecordsPort[] = []) => {
  let clock = 1_790_000_000_000;
  const server = new McpServer({ name: "trademarks", version: "test" });
  registerAll(guard(server, { service: "trademarks", policy: POLICY, log: () => undefined }), { registers, records, outbox: fakeOutbox, now: () => (clock += 40) });
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Every successful answer is checked against its output schema by the guard and carries it as
  // structured content, the same JSON as the text; a failure carries none.
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; structuredContent?: unknown; isError?: boolean };
    const parsed = JSON.parse(result.content[0]?.text ?? "{}");
    expect(result.structuredContent).toEqual(result.isError === true ? undefined : parsed);
    return parsed;
  };
  return { call, client };
};

const notConfigured = register({ office: "EM", source: "euipo-api", search: async () => fail(configError("euipo-api", "EUIPO's API is not configured")), probe: async () => fail(configError("euipo-api", "not configured")) });

describe("search_marks", () => {
  it("answers for every office: what one found, why another was not searched, never an empty silence", async () => {
    const us = register({ office: "US", source: "uspto-tmsearch" });
    const { call } = await connected([us, notConfigured]);
    const result = await call("search_marks", { name: "Turnip", classes: [42, 9, 35, 9] });

    expect(us.asked).toEqual([{ name: "Turnip", classes: [9, 35, 42], match: "similar", status: "live" }]);
    expect(result).toMatchObject({ name: "Turnip", match: "similar", status: "live", classes: [9, 35, 42] });
    const [em, usSection, ro, wo] = result.offices;
    expect(em).toMatchObject({ office: "EM", source: "euipo-api", searched: false, error: { kind: "config", remedy: expect.stringContaining("dev.euipo.europa.eu") } });
    expect(ro).toMatchObject({ office: "RO", searched: false, reason: expect.stringContaining("reCAPTCHA") });
    expect(wo).toMatchObject({ office: "WO", searched: false, reason: expect.stringContaining("automated queries") });

    // Not in the classes asked (7, 20) and dead are dropped; identical first, registered before pending.
    expect(usSection).toMatchObject({ office: "US", searched: true, found: 42, examined: 6, more: true, counts: { identical: 2, contains: 1, similar: 1 } });
    expect(usSection.marks.map((m: { id: string; relation: string }) => `${m.id}:${m.relation}`)).toEqual(["4:identical", "2:identical", "3:contains", "1:similar"]);
    expect(usSection.marks[0]).not.toHaveProperty("office");
    // Scored here, the same for every office: DURNIP is written one letter off and sounds the same.
    expect(usSection.marks.map((m: { similarity: number }) => m.similarity)).toEqual([100, 100, 67, 92]);
  });

  it("keeps only identical marks for exact, dead ones too with status all, and lists at most limit", async () => {
    const { call } = await connected([register({ office: "US", source: "uspto-tmsearch" })]);
    const exact = await call("search_marks", { name: "turnip", offices: ["US"], match: "exact", status: "all", limit: 2 });
    expect(exact.offices).toHaveLength(1);
    expect(exact.offices[0]).toMatchObject({ counts: { identical: 4, contains: 0, similar: 0 } });
    expect(exact.offices[0].marks.map((m: { id: string }) => m.id)).toEqual(["4", "5"]);
    expect(exact).not.toHaveProperty("classes");
  });

  it("reports one office's failure in its section and answers for the rest", async () => {
    const broken = register({ office: "US", source: "uspto-tmsearch", search: async () => fail({ kind: "api", source: "uspto-tmsearch", status: 503, message: "USPTO is down" }) });
    const { call } = await connected([broken, register({ office: "EM", source: "euipo-api" })]);
    const result = await call("search_marks", { name: "Turnip", offices: ["US", "EM"] });
    expect(result.offices[0]).toMatchObject({ office: "US", searched: false, error: { kind: "api", message: "USPTO is down" } });
    expect(result.offices[1]).toMatchObject({ office: "EM", searched: true });
  });

  it("passes goods to each register and says per office whether they filtered its marks", async () => {
    const us = register({ office: "US", source: "uspto-tmsearch" });
    const em = register({ office: "EM", source: "euipo-api" });
    const { call } = await connected([us, em]);
    const result = await call("search_marks", { name: "Turnip", offices: ["US", "EM"], goods: "  computer software " });
    expect(us.asked[0]).toMatchObject({ goods: "computer software" });
    expect(result).toMatchObject({ goods: "computer software" });
    expect(result.offices[0]).toMatchObject({ office: "US", goods_filter: "applied" });
    expect(result.offices[1]).toMatchObject({ office: "EM", goods_filter: "unsupported" });
    const without = await call("search_marks", { name: "Turnip", offices: ["US"] });
    expect(without).not.toHaveProperty("goods");
    expect(without.offices[0]).not.toHaveProperty("goods_filter");
  });

  it("refuses a pattern before any register is asked", async () => {
    const us = register({ office: "US", source: "uspto-tmsearch" });
    const { client } = await connected([us]);
    const refused = (await client.callTool({ name: "search_marks", arguments: { name: "tur*" } })) as { isError?: boolean; content: { text: string }[] };
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("not a pattern");
    expect(us.asked).toHaveLength(0);
  });
});

describe("get_mark", () => {
  it("reads one mark from its office and names the source", async () => {
    const { call } = await connected([register({ office: "US", source: "uspto-tmsearch" })]);
    expect(await call("get_mark", { office: "US", id: "90000001" })).toMatchObject({ source: "uspto-tmsearch", id: "90000001", goodsAndServices: [{ class: 42 }] });
  });

  it("says why an office cannot be read", async () => {
    const { call } = await connected([register({ office: "US", source: "uspto-tmsearch" })]);
    expect(await call("get_mark", { office: "RO", id: "123" })).toMatchObject({ error: { kind: "unsupported", message: expect.stringContaining("tmview") } });
  });
});

const records = (over: Partial<RecordsPort> = {}): RecordsPort => ({
  office: "US",
  source: "uspto-tsdr",
  history: async (id) => ({
    office: "US",
    id,
    mark: "TURNIP",
    status: "registered",
    statusText: "Registered.",
    statusCode: 700,
    statusDate: "2011-02-01",
    filed: "2010-01-04",
    registered: "2011-02-01",
    registrationNumber: "7100001",
    events: [{ date: "2011-02-01", code: "R.PR", description: "REGISTERED-PRINCIPAL REGISTER", number: 2 }],
    link: `https://example.test/${id}`,
  }),
  documents: async () => [{ date: "2010-06-01", type: "OOA", description: "Offc Action Outgoing", category: "outgoing", pages: 5 }],
  bundle: async () => new TextEncoder().encode("%PDF-1.4"),
  probe: async () => undefined,
  ...over,
});

describe("a mark's file", () => {
  it("answers a US mark's history, documents and a saved bundle, as typed structured content", async () => {
    const { call } = await connected([register({ office: "US", source: "uspto-tmsearch" })], [records()]);
    expect(await call("mark_history", { office: "US", id: "97000001" })).toMatchObject({ source: "uspto-tsdr", id: "97000001", status: "registered", events: [{ code: "R.PR" }] });
    expect(await call("mark_documents", { office: "US", id: "97000001" })).toEqual({
      source: "uspto-tsdr",
      office: "US",
      id: "97000001",
      count: 1,
      documents: [{ date: "2010-06-01", type: "OOA", description: "Offc Action Outgoing", category: "outgoing", pages: 5 }],
    });
    expect(await call("download_mark_documents", { office: "US", id: "97000001", type: "OOA" })).toEqual({
      source: "uspto-tsdr",
      office: "US",
      id: "97000001",
      type: "OOA",
      path: "/srv/trademarks-outbox/us-97000001-OOA.pdf",
      sha256: "0".repeat(64),
      size: 8,
    });
  });

  it("says why another office's file cannot be read here, and refuses a type that is not a code", async () => {
    const { call, client } = await connected([], [records()]);
    expect(await call("mark_history", { office: "EM", id: "018000001" })).toMatchObject({ error: { kind: "unsupported", message: expect.stringContaining("eSearch") } });
    expect(await call("mark_documents", { office: "RO", id: "123" })).toMatchObject({ error: { kind: "unsupported", message: expect.stringContaining("tmview") } });
    const refused = (await client.callTool({ name: "download_mark_documents", arguments: { office: "US", id: "97000001", type: "OOA&x=1" } })) as { isError?: boolean };
    expect(refused.isError).toBe(true);
  });
});

describe("health", () => {
  it("is ok with a source waiting for credentials, and says what it waits for", async () => {
    const { call } = await connected([register({ office: "US", source: "uspto-tmsearch" }), notConfigured]);
    const health = await call("health");
    expect(health.ok).toBe(true);
    expect(health.sources).toMatchObject([
      { office: "US", state: "ok", ms: expect.any(Number) },
      { office: "EM", state: "not_configured", remedy: expect.stringContaining("dev.euipo.europa.eu") },
    ]);
    expect(health.uncovered.map((u: { office: string }) => u.office)).toEqual(["RO", "WO"]);
    expect(health.records).toEqual([]);
  });

  it("reports the case-file source beside the registers, and is not ok when it fails", async () => {
    const us = register({ office: "US", source: "uspto-tmsearch" });
    const fine = await (await connected([us], [records()])).call("health");
    expect(fine).toMatchObject({ ok: true, records: [{ office: "US", source: "uspto-tsdr", official: true, state: "ok" }] });
    const noKey = await (await connected([us], [records({ probe: async () => fail(configError("uspto-tsdr", "no key")) })])).call("health");
    expect(noKey).toMatchObject({ ok: true, records: [{ state: "not_configured", remedy: expect.stringContaining("api-manager") }] });
    const refused = await (await connected([us], [records({ probe: async () => fail({ kind: "auth", source: "uspto-tsdr", status: 401, message: "refused" }) })])).call("health");
    expect(refused).toMatchObject({ ok: false, records: [{ state: "failing", error: { kind: "auth" } }] });
  });

  it("is ok while a register approves access, and says so", async () => {
    const pending = register({ office: "EM", source: "euipo-api", probe: async () => fail({ kind: "subscription", source: "euipo-api", status: 401, message: "refused" }) });
    const health = await (await connected([register({ office: "US", source: "uspto-tmsearch" }), pending])).call("health");
    expect(health.ok).toBe(true);
    expect(health.sources[1]).toMatchObject({ office: "EM", state: "pending", remedy: expect.stringContaining("approval") });
  });

  it("is not ok when a configured source fails, or when nothing can search", async () => {
    const failing = register({ office: "US", source: "uspto-tmsearch", probe: async () => fail({ kind: "api", source: "uspto-tmsearch", status: 403, message: "refused" }) });
    expect((await (await connected([failing, register({ office: "EM", source: "euipo-api" })])).call("health")).ok).toBe(false);
    expect((await (await connected([notConfigured])).call("health")).ok).toBe(false);
  });
});

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot", async () => {
    const { client } = await connected([]);
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
  });

  it("classifies every tool it registers, and nothing else", () => {
    const deps = buildDeps({});
    expect(() => checkPolicy("trademarks", (server) => registerAll(server, deps), POLICY)).not.toThrow();
  });

  it("builds only the sources asked for", () => {
    expect(buildDeps({}).registers.map((r) => r.office)).toEqual(["US", "EM"]);
    expect(buildDeps({ TRADEMARKS_SOURCES: "euipo" }).registers.map((r) => r.office)).toEqual(["EM"]);
    expect(buildDeps({}).records.map((r) => r.source)).toEqual(["uspto-tsdr"]);
    expect(buildDeps({ TRADEMARKS_SOURCES: "uspto" }).records).toEqual([]);
  });
});
