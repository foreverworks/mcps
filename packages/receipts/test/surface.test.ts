/**
 * The shared tool surface and health check, against a fake server: the tools
 * register in the order a client lists them, the policy covers exactly them,
 * failures carry the server's own remedy, and the health line keeps its contract.
 */
import { checkPolicy, connectInMemory, makeErrorKit, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { OK, PERMANENT, runHealthCli, TRANSIENT } from "../src/cli/index.js";
import { type CommonError, commonRemedy, configError, joinErrors } from "../src/domain/index.js";
import { POLICY, type ReceiptTools, registerReceiptTools } from "../src/mcp/index.js";

type Own = { readonly kind: "auth"; readonly message: string; readonly permanent: boolean };
const errors = joinErrors(makeErrorKit<Own>("surface"));
const vocabulary = {
  asAppError: errors.asAppError,
  remedyFor: (e: Own | CommonError) => (e.kind === "auth" ? "re-extract the token" : commonRemedy(e)),
};

const DEPS = { timeZone: "Europe/Lisbon" };

const tools: ReceiptTools<typeof DEPS, Own | CommonError> = {
  copy: {
    health: "h",
    getReceipt: "r",
    getReceipts: "rs",
    searchItems: "s",
    exportItems: "e",
    matchCardCharges: "m",
    orderStats: "o",
    firstDate: "First date",
    lastDate: "Last date",
    detail: "d",
    state: { values: ["delivered", "canceled"], description: "st" },
  },
  vocabulary,
  listOrders: (server, _deps, handled) => {
    server.registerTool("list_orders", { description: "l", inputSchema: { limit: z.number() } }, handled(async () => []));
  },
  health: async () => errors.fail({ kind: "auth", message: "refused", permanent: true }),
  getReceipt: async (_deps, orderId) => ({ orderId }),
  useCases: {
    getReceipts: async () => ({ count: 0, receipts: [] }),
    searchItems: async () => ({}),
    exportItems: async () => ({}),
    matchCardCharges: async (_deps, input) => ({ charges: input.charges.length }),
    orderStats: async () => ({}),
  },
};

const connect = async () => {
  const server = new McpServer({ name: "fake", version: "test" });
  registerReceiptTools(server, DEPS, tools);
  const client = await connectInMemory(server);
  return client;
};

const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

describe("registerReceiptTools", () => {
  it("registers the whole surface in the order clients list it, and the policy covers exactly that", async () => {
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(names).toEqual(["health", "list_orders", "get_receipt", "get_receipts", "match_card_charges", "search_items", "export_items", "order_stats"]);
    expect(() => checkPolicy("fake", (server) => registerReceiptTools(server, DEPS, tools), POLICY)).not.toThrow();
  });

  it("answers a failure in the envelope with the server's own remedy", async () => {
    const client = await connect();
    const failed = await client.callTool({ name: "health", arguments: {} });
    expect(failed.isError).toBe(true);
    expect(parse(failed).error).toEqual({ kind: "auth", message: "refused", permanent: true, remedy: "re-extract the token" });
    expect(parse(await client.callTool({ name: "get_receipt", arguments: { order_id: 7 } }))).toEqual({ orderId: 7 });
  });

  it("describes every date argument in the server's configured zone", async () => {
    const listed = (await (await connect()).listTools()).tools.find((t) => t.name === "get_receipts");
    expect(JSON.stringify(listed?.inputSchema)).toContain("as a calendar date in Europe/Lisbon");
  });

  it("fills the defaults a caller leaves out", async () => {
    const out = await (await connect()).callTool({ name: "match_card_charges", arguments: { charges: [{ id: "a", date: "2026-03-10", amount: "-1", currency: "RON" }] } });
    expect(parse(out)).toEqual({ charges: 1 });
  });
});

describe("runHealthCli", () => {
  const run = async (check: () => Promise<number>) => {
    const lines: string[] = [];
    const exit = await runHealthCli(
      { label: "FAKE", check, verdict: (n) => ({ exit: n === 0 ? OK : PERMANENT, line: `ok n=${n}` }), vocabulary },
      (line) => lines.push(line),
    );
    return { exit, lines };
  };

  it("starts every line with the label, whatever the verdict", async () => {
    expect(await run(async () => 0)).toEqual({ exit: OK, lines: ["FAKE: ok n=0"] });
    expect(await run(async () => errors.fail(configError("no file")))).toEqual({
      exit: PERMANENT,
      lines: [`FAKE: FAIL no file -- ${commonRemedy({ kind: "config", message: "" })}`],
    });
    expect(await run(async () => errors.fail({ kind: "auth", message: "later", permanent: false }))).toEqual({
      exit: TRANSIENT,
      lines: ["FAKE: WARN later -- re-extract the token"],
    });
    expect(await run(async () => Promise.reject(new Error("bug")))).toEqual({ exit: PERMANENT, lines: ["FAKE: FAIL unexpected: Error: bug"] });
  });
});
