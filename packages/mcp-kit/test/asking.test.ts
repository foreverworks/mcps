import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer, type ProtocolEra } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { makeHandled } from "../src/envelope.js";
import { makeErrorKit } from "../src/errors.js";
import type { ToolPolicy } from "../src/policy.js";
import { digestOf } from "../src/serve/asking.js";
import { guard } from "../src/serve/guard.js";
import { MCP_PATH, serve } from "../src/serve.js";
import { confirmingClient, connectInMemory } from "../src/smoke.js";

/**
 * A money call confirmed by elicitation (MCP_CONFIRM=elicit) in both protocol
 * generations, and what the state that carries the question refuses.
 */

type E = { kind: "refused"; message: string };
const kit = makeErrorKit<E>("asking-test");
const handled = makeHandled<E>({ asAppError: kit.asAppError, remedyFor: () => "no" });

const paid: string[] = [];
const policy: ToolPolicy = {
  pay_it: { access: "money", summary: (args) => `pay ${String(args["amount"])} RON to ${String(args["to"])}` },
  refund_it: { access: "money", summary: (args) => `refund ${String(args["amount"])} RON` },
};
const register = (server: McpServer): void => {
  server.registerTool(
    "pay_it",
    { description: "pays.", inputSchema: { amount: z.string(), to: z.string() } },
    handled(async ({ amount, to }: { amount: string; to: string }) => {
      paid.push(`${amount}->${to}`);
      return { paid: amount };
    }),
  );
  server.registerTool(
    "refund_it",
    { description: "refunds.", inputSchema: { amount: z.string() } },
    handled(async ({ amount }: { amount: string }) => ({ refunded: amount })),
  );
};
const make = () => {
  const server = new McpServer({ name: "t", version: "0" });
  register(guard(server, { service: "svc", policy, settings: { maxAccess: "money", confirm: "elicit" }, log: () => undefined }));
  return server;
};

const json = (result: unknown) => JSON.parse((result as { content: [{ text: string }] }).content[0].text) as Record<string, unknown>;

beforeEach(() => {
  paid.length = 0;
});

describe.each(["legacy", "modern"] as const)("a money call confirmed by the server, protocol %s over stdio", (era: ProtocolEra) => {
  it("runs once on a yes, never on a no, and asks with the policy's line", async () => {
    const answers = [true, false];
    const { client, asked } = confirmingClient("c", () => answers.shift() ?? false, era);
    await connectInMemory(make, client);
    expect(json(await client.callTool({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }))).toEqual({ paid: "10.00" });
    expect(json(await client.callTool({ name: "pay_it", arguments: { amount: "20.00", to: "y" } }))).toMatchObject({ error: { kind: "confirmation_denied" } });
    expect(paid).toEqual(["10.00->x"]);
    expect(asked).toEqual(["svc: pay 10.00 RON to x", "svc: pay 20.00 RON to y"]);
  });
});

describe("a money call confirmed by the server over HTTP", () => {
  const httpServe = async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-asking-"));
    const tokenFile = join(dir, "token");
    const token = "asking-test-token-0123456789";
    await writeFile(tokenFile, `${token}\n`);
    const served = await serve({
      name: "t",
      version: "0",
      register,
      policy,
      env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: tokenFile, MCP_CONFIRM: "elicit" },
      log: () => undefined,
    });
    const url = new URL(`http://127.0.0.1:${served.port}${MCP_PATH}`);
    return { served, transport: () => new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }) };
  };

  it("is asked of a 2026-07-28 client, which calls again with the answer", async () => {
    const { served, transport } = await httpServe();
    try {
      const { client, asked } = confirmingClient("c", () => true, "modern");
      await client.connect(transport());
      expect(json(await client.callTool({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }))).toEqual({ paid: "10.00" });
      expect(asked).toEqual(["t: pay 10.00 RON to x"]);
      expect(paid).toEqual(["10.00->x"]);
      await client.close();
    } finally {
      await served.close();
    }
  });

  it("is refused to a 2025-11-25 client, whose stateless transport cannot carry the question back", async () => {
    const { served, transport } = await httpServe();
    try {
      const { client, asked } = confirmingClient("c", () => true);
      await client.connect(transport());
      expect(json(await client.callTool({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }))).toMatchObject({
        error: { kind: "confirmation_unavailable", message: expect.stringContaining("2025-11-25 over HTTP") },
      });
      expect(asked).toEqual([]);
      expect(paid).toEqual([]);
      await client.close();
    } finally {
      await served.close();
    }
  });
});

describe("the state a question travels in", () => {
  /** A 2026-07-28 client that sees each question itself and decides what to send back. */
  const manual = async () => {
    const client = new Client(
      { name: "c", version: "0" },
      { capabilities: { elicitation: {} }, versionNegotiation: { mode: { pin: "2026-07-28" } }, inputRequired: { autoFulfill: false } },
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    serveStdio(make, { transport: serverSide });
    await client.connect(clientSide);
    const call = (params: Record<string, unknown>) =>
      client.request({ method: "tools/call", params: params as { name: string } }, { allowInputRequired: true }) as Promise<Record<string, unknown>>;
    return { call };
  };
  const yes = { confirm: { action: "accept", content: { confirm: true } } };

  it("asks first, then runs on the answer it brings", async () => {
    const { call } = await manual();
    const asked = await call({ name: "pay_it", arguments: { amount: "10.00", to: "x" } });
    expect(asked).toMatchObject({ resultType: "input_required", inputRequests: { confirm: { method: "elicitation/create" } }, requestState: expect.any(String) });
    expect(paid).toEqual([]);
    const done = await call({ name: "pay_it", arguments: { amount: "10.00", to: "x" }, inputResponses: yes, requestState: asked["requestState"] });
    expect(json(done)).toEqual({ paid: "10.00" });
  });

  it("refuses the answer for other arguments, a second time, for another tool, or forged", async () => {
    const { call } = await manual();
    const state = async () => (await call({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }))["requestState"];

    const swapped = await call({ name: "pay_it", arguments: { amount: "9999.00", to: "x" }, inputResponses: yes, requestState: await state() });
    expect(json(swapped)).toMatchObject({ error: { kind: "confirmation_invalid", message: expect.stringContaining("other than the ones the user confirmed") } });

    const once = await state();
    expect(json(await call({ name: "pay_it", arguments: { amount: "10.00", to: "x" }, inputResponses: yes, requestState: once }))).toEqual({ paid: "10.00" });
    const again = await call({ name: "pay_it", arguments: { amount: "10.00", to: "x" }, inputResponses: yes, requestState: once });
    expect(json(again)).toMatchObject({ error: { kind: "confirmation_invalid", message: expect.stringContaining("used already") } });

    const elsewhere = await call({ name: "refund_it", arguments: { amount: "10.00" }, inputResponses: yes, requestState: await state() });
    expect(json(elsewhere)).toMatchObject({ error: { kind: "confirmation_invalid", message: expect.stringContaining("another call") } });

    // The MAC's first character, not its last: the last of 43 base64url characters carries two padding bits, so
    // changing only those leaves the MAC as it was, and the "forged" state verified in about 1 run in 17.
    const forged = String(await state()).replace(/\.(.)([^.]*)$/, (_, c: string, rest: string) => `.${c === "A" ? "B" : "A"}${rest}`);
    expect(json(await call({ name: "pay_it", arguments: { amount: "10.00", to: "x" }, inputResponses: yes, requestState: forged }))).toMatchObject({
      error: { kind: "confirmation_invalid" },
    });
    expect(paid).toEqual(["10.00->x"]);
  });
});

describe("digestOf", () => {
  it("is the same for the same arguments in any key order, and differs for any change, bytes included", () => {
    expect(digestOf({ a: "1", b: { c: [1, 2] } })).toBe(digestOf({ b: { c: [1, 2] }, a: "1" }));
    expect(digestOf({ a: "1" })).not.toBe(digestOf({ a: "2" }));
    expect(digestOf({ f: Buffer.from("x") })).not.toBe(digestOf({ f: Buffer.from("y") }));
    expect(digestOf({ a: "1", gone: undefined })).toBe(digestOf({ a: "1" }));
  });
});
