import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPolicy, makeErrorKit, McpServer, StreamableHTTPClientTransport, testClient, type Served } from "@foreverworks/mcp-kit";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { type CommonError, commonRemedy, joinErrors } from "../src/domain/index.js";
import { POLICY, type ReceiptTools, registerReceiptTools, startServer } from "../src/mcp/index.js";

/**
 * The allowlist (MCP_EGRESS_ALLOW) holds for a server started the way a
 * receipts server starts, even when its API client takes `fetch` while its
 * dependencies are built, which is what the Bolt Food and Glovo clients did:
 * `buildDeps` runs before `serve`, and `serve` is where the guard used to go in
 * force, so a client built first kept the unguarded function for good.
 *
 * No request leaves the machine: the "API" is a stub on loopback, reached
 * under two names (127.0.0.1 is on the list, localhost is not) and counting
 * what arrives, so a refusal is shown to have happened before a connection.
 */

type Own = { readonly kind: "auth"; readonly message: string };
const errors = joinErrors(makeErrorKit<Own>("egress"));

/** The dependencies, built the way a captured client is: the fetch is held from the moment they exist. */
const buildDeps = () => {
  const held = fetch;
  return { timeZone: "UTC", get: async (url: string): Promise<string> => (await held(url)).text() };
};
type Deps = ReturnType<typeof buildDeps>;

/** Only list_orders does anything: it fetches the URL it is given through the held fetch. */
const tools: ReceiptTools<Deps, Own | CommonError> = {
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
    state: { values: ["delivered"], description: "st" },
  },
  vocabulary: { asAppError: errors.asAppError, remedyFor: (e: Own | CommonError) => (e.kind === "auth" ? "sign in again" : commonRemedy(e)) },
  listOrders: (server, deps, handled) => {
    server.registerTool("list_orders", { description: "l", inputSchema: { url: z.string() } }, handled(async ({ url }) => ({ body: await deps.get(url) })));
  },
  health: async () => ({}),
  getReceipt: async () => ({}),
  useCases: {
    getReceipts: async () => ({}),
    searchItems: async () => ({}),
    exportItems: async () => ({}),
    matchCardCharges: async () => ({}),
    orderStats: async () => ({}),
  },
};

const ENV_KEYS = ["MCP_HTTP_PORT", "MCP_HTTP_TOKEN_FILE", "MCP_EGRESS_ALLOW"] as const;

describe("a receipts server started through its entry point", () => {
  const token = "egress-test-token-0123456789";
  const realFetch = globalThis.fetch;
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let upstream: Server;
  let reached: string[];
  let upstreamPort: number;
  let served: Served;
  let url: URL;

  beforeAll(async () => {
    reached = [];
    upstream = createServer((request, response) => {
      reached.push(`${request.headers.host ?? ""}${request.url ?? ""}`);
      response.end("from upstream");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const dir = await mkdtemp(join(tmpdir(), "receipts-egress-"));
    const tokenFile = join(dir, "token");
    await writeFile(tokenFile, `${token}\n`);
    process.env["MCP_HTTP_PORT"] = "0";
    process.env["MCP_HTTP_TOKEN_FILE"] = tokenFile;
    process.env["MCP_EGRESS_ALLOW"] = "127.0.0.1";
    served = await startServer({
      name: "egress-test",
      version: "0.0.0",
      instructions: "i",
      buildDeps,
      register: (server: McpServer, deps: Deps) => registerReceiptTools(server, deps, tools),
      healthCheck: async () => 0,
    });
    url = new URL(`http://127.0.0.1:${served.port}/mcp`);
  });

  afterEach(() => {
    reached.length = 0;
  });

  afterAll(async () => {
    await served.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    globalThis.fetch = realFetch;
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const listOrders = async (target: string): Promise<{ readonly isError?: boolean | undefined; readonly text: string }> => {
    const client = testClient("egress-test-client");
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    try {
      const result = await client.callTool({ name: "list_orders", arguments: { url: target } });
      return { isError: result.isError, text: (result.content as { text: string }[])[0]?.text ?? "" };
    } finally {
      await client.close();
    }
  };

  it("serves the tools the policy classifies", () => {
    expect(() => checkPolicy("egress-test", (server) => registerReceiptTools(server, buildDeps(), tools), POLICY)).not.toThrow();
  });

  it("refuses a host outside MCP_EGRESS_ALLOW through a fetch the dependencies took early, and never connects", async () => {
    const answer = await listOrders(`http://localhost:${upstreamPort}/orders`);
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("MCP_EGRESS_ALLOW");
    expect(answer.text).toContain("localhost");
    expect(reached).toEqual([]);
  });

  it("allows a host inside it through the same fetch", async () => {
    const answer = await listOrders(`http://127.0.0.1:${upstreamPort}/orders`);
    expect(answer.isError).not.toBe(true);
    expect(JSON.parse(answer.text)).toEqual({ body: "from upstream" });
    expect(reached).toEqual([`127.0.0.1:${upstreamPort}/orders`]);
  });
});
