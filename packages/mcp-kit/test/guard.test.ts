import { Client, type ClientCapabilities } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import type { Transport } from "@modelcontextprotocol/client";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { pause, reportProgress } from "../src/call.js";
import { makeHandled } from "../src/envelope.js";
import { makeErrorKit } from "../src/errors.js";
import { readInputFile } from "../src/inputFile.js";
import { idempotentWrites, type ToolPolicy } from "../src/policy.js";
import { type GuardSettings, guardSettingsFrom } from "../src/serve/confirm.js";
import { ACCESS_META, guard, registeredNames, REQUIRES_USER_META } from "../src/serve/guard.js";
import { checkPolicy } from "../src/serve.js";

type E = { kind: "not_found"; message: string };
const kit = makeErrorKit<E>("guard-test");
const handled = makeHandled<E>({ asAppError: kit.asAppError, remedyFor: () => "look elsewhere" });

const policy: ToolPolicy = {
  read_it: { access: "read" },
  lose_it: { access: "write" },
  pay_it: { access: "money", summary: (args) => `pay ${String(args["amount"])} RON\nto ${String(args["to"])}` },
};

const effects: string[] = [];
const register = (server: McpServer): void => {
  server.registerTool("read_it", { description: "reads", inputSchema: { account: z.string() } }, handled(async ({ account }: { account: string }) => ({ account })));
  server.registerTool("lose_it", { description: "fails", inputSchema: {} }, handled(async () => kit.fail({ kind: "not_found", message: "gone" })));
  server.registerTool(
    "pay_it",
    { description: "pays.", inputSchema: { amount: z.string(), to: z.string() } },
    handled(async ({ amount, to }: { amount: string; to: string }) => {
      effects.push(`${amount}->${to}`);
      return { paid: amount };
    }),
  );
};

const ALL: GuardSettings = { maxAccess: "money", confirm: "client" };

const connect = async (settings: GuardSettings = ALL, capabilities: ClientCapabilities = {}) => {
  const lines: string[] = [];
  const server = new McpServer({ name: "t", version: "0" });
  register(guard(server, { service: "svc", policy, settings, log: (l) => lines.push(l) }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a as Transport);
  const client = new Client({ name: "c", version: "0" }, { capabilities });
  await client.connect(b as Transport);
  const audit = () => lines.map((l) => JSON.parse(l.replace(/^audit /, "")) as Record<string, unknown>);
  return { client, audit };
};

const parse = (result: unknown) => JSON.parse((result as { content: [{ text: string }] }).content[0].text) as Record<string, unknown>;

beforeEach(() => {
  effects.length = 0;
});

describe("guard", () => {
  it("refuses an argument the tool does not name, instead of dropping it", async () => {
    const { client } = await connect();
    const typo = await client.callTool({ name: "read_it", arguments: { account: "personal", days: 3 } });
    expect(typo.isError).toBe(true);
    expect(JSON.stringify(typo.content)).toContain("days");
    const listed = await client.listTools();
    expect(listed.tools.find((t) => t.name === "read_it")?.inputSchema).toMatchObject({ additionalProperties: false });
  });

  it("tells the client which tools only read and which spend, from the policy", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(Object.fromEntries(tools.map((t) => [t.name, t.annotations]))).toEqual({
      read_it: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      lose_it: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      pay_it: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    });
    expect(Object.fromEntries(tools.map((t) => [t.name, t._meta]))).toEqual({
      read_it: { [ACCESS_META]: "read" },
      lose_it: { [ACCESS_META]: "write" },
      pay_it: { [ACCESS_META]: "money", [REQUIRES_USER_META]: true },
    });
    expect(tools.find((t) => t.name === "pay_it")?.description).toBe("pays. Moves money or makes a legal document: the client asks the user to approve each call.");
  });

  it("lists tools in name order, whatever order they were registered in", async () => {
    const { client } = await connect();
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["lose_it", "pay_it", "read_it"]);
    expect(parse(await client.callTool({ name: "read_it", arguments: { account: "a" } }))).toEqual({ account: "a" });
  });

  it("keeps a tool's own handle working after the order is rebuilt", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    const guarded = guard(server, { service: "svc", policy: { b_tool: { access: "read" }, a_tool: { access: "read" } }, log: () => {} });
    const b = guarded.registerTool("b_tool", { description: "b", inputSchema: {} }, handled(async () => "b"));
    guarded.registerTool("a_tool", { description: "a", inputSchema: {} }, handled(async () => "a"));
    b.update({ description: "b, changed" });
    const [x, y] = InMemoryTransport.createLinkedPair();
    await server.connect(x as Transport);
    const client = new Client({ name: "c", version: "0" });
    await client.connect(y as Transport);
    expect((await client.listTools()).tools.map((t) => [t.name, t.description])).toEqual([
      ["a_tool", "a"],
      ["b_tool", "b, changed"],
    ]);
  });

  it("calls a write idempotent only when its policy line says so, whatever the tool claims", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    const guarded = guard(server, { service: "svc", policy: { label_it: { access: "write", idempotent: true }, send_it: { access: "write" }, local_it: { access: "read" } }, log: () => {} });
    guarded.registerTool("label_it", { description: "labels", inputSchema: {} }, handled(async () => "ok"));
    guarded.registerTool("send_it", { description: "sends", inputSchema: {}, annotations: { idempotentHint: true } }, handled(async () => "ok"));
    guarded.registerTool("local_it", { description: "reads a local file", inputSchema: {}, annotations: { openWorldHint: false } }, handled(async () => "ok"));
    const [x, y] = InMemoryTransport.createLinkedPair();
    await server.connect(x as Transport);
    const client = new Client({ name: "c", version: "0" });
    await client.connect(y as Transport);
    const hints = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, [t.annotations?.idempotentHint, t.annotations?.openWorldHint]]));
    expect(hints).toEqual({ label_it: [true, true], send_it: [false, true], local_it: [true, false] });
  });

  it("names the writes a policy declares idempotent, for the test each one needs", () => {
    expect(idempotentWrites({ b: { access: "write", idempotent: true }, a: { access: "write", idempotent: true }, c: { access: "write" }, d: { access: "read" } })).toEqual(["a", "b"]);
  });

  it("writes one audit line per call, with the account and no arguments", async () => {
    const { client, audit } = await connect();
    await client.callTool({ name: "read_it", arguments: { account: "personal" } });
    const failed = await client.callTool({ name: "lose_it", arguments: {} });
    expect(failed.isError).toBe(true);
    expect(parse(failed)).toEqual({ error: { kind: "not_found", message: "gone", remedy: "look elsewhere" } });
    expect(audit()).toEqual([
      { svc: "svc", tool: "read_it", client: "stdio", account: "personal", access: "read", outcome: "ok", ms: expect.any(Number) },
      { svc: "svc", tool: "lose_it", client: "stdio", account: null, access: "write", outcome: "not_found", ms: expect.any(Number) },
    ]);
  });

  it("runs a money tool on the client's word by default: confirming is the client's job, which the tool asks of it", async () => {
    const { client, audit } = await connect();
    expect(parse(await client.callTool({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }))).toEqual({ paid: "10.00" });
    expect(effects).toEqual(["10.00->x"]);
    expect(audit()[0]).toEqual({ svc: "svc", tool: "pay_it", client: "stdio", account: null, access: "money", outcome: "ok", ms: expect.any(Number) });
  });

  it("lists a tool above the ceiling as disabled, and refuses it without running it", async () => {
    const { client, audit } = await connect({ maxAccess: "read", confirm: "client" });
    const described = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.description]));
    expect(described["lose_it"]).toBe("fails Disabled on this server, which runs read tools at most.");
    expect(described["read_it"]).toBe("reads");
    const refused = parse(await client.callTool({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }));
    expect(refused).toMatchObject({ error: { kind: "access_denied", access: "money", allowed: "read", remedy: expect.stringContaining("MCP_MAX_ACCESS") } });
    expect(effects).toEqual([]);
    expect(audit()[0]).toMatchObject({ tool: "pay_it", outcome: "access_denied" });
    expect(parse(await client.callTool({ name: "read_it", arguments: { account: "a" } }))).toEqual({ account: "a" });
  });

  it("holds a named client to its own ceiling, under the server's, and names the setting", async () => {
    const { client, audit } = await connect({ maxAccess: "money", confirm: "client", clientMaxAccess: { stdio: "read", other: "write" } });
    expect((await client.listTools()).tools.find((t) => t.name === "pay_it")?.description).not.toContain("Disabled");
    const refused = parse(await client.callTool({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }));
    expect(refused).toMatchObject({ error: { kind: "access_denied", access: "money", allowed: "read", client: "stdio", remedy: expect.stringContaining("MCP_CLIENT_MAX_ACCESS") } });
    expect(effects).toEqual([]);
    expect(audit()[0]).toMatchObject({ tool: "pay_it", client: "stdio", outcome: "access_denied" });
    expect(parse(await client.callTool({ name: "read_it", arguments: { account: "a" } }))).toEqual({ account: "a" });
  });
});

describe("guard, confirming money calls with the user (MCP_CONFIRM=elicit)", () => {
  const ELICIT: GuardSettings = { maxAccess: "money", confirm: "elicit" };

  it("asks the user in the call with the policy's line, and runs only on a yes", async () => {
    const { client, audit } = await connect(ELICIT, { elicitation: {} });
    const prompts: string[] = [];
    const answers = [true, false];
    client.setRequestHandler("elicitation/create", async (request) => {
      prompts.push(request.params.message);
      return { action: "accept", content: { confirm: answers.shift() ?? false } };
    });
    expect(parse(await client.callTool({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }))).toEqual({ paid: "10.00" });
    expect(parse(await client.callTool({ name: "pay_it", arguments: { amount: "20.00", to: "y" } }))).toMatchObject({ error: { kind: "confirmation_denied" } });
    expect(effects).toEqual(["10.00->x"]);
    expect(prompts).toEqual(["Confirm? svc: pay 10.00 RON to x", "Confirm? svc: pay 20.00 RON to y"]);
    expect(audit().map((l) => [l["outcome"], l["confirmed"] ?? l["asked"]])).toEqual([
      ["asked", "confirm"],
      ["ok", "elicit"],
      ["asked", "confirm"],
      ["confirmation_denied", undefined],
    ]);
  });

  it("refuses at a client that cannot show the question, and says so in the description", async () => {
    const { client } = await connect(ELICIT);
    expect((await client.listTools()).tools.find((t) => t.name === "pay_it")?.description).toContain("the server asks the user to confirm each call");
    expect(parse(await client.callTool({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }))).toMatchObject({ error: { kind: "confirmation_unavailable" } });
    expect(effects).toEqual([]);
  });

  it("reads the settings, elicitation included on either transport (2026-07-28 carries the question over HTTP)", () => {
    expect(guardSettingsFrom({ MCP_CONFIRM: "elicit" })).toEqual({ maxAccess: "money", confirm: "elicit" });
    expect(() => guardSettingsFrom({ MCP_MAX_ACCESS: "admin" })).toThrow(/not one of read, write, money/);
    expect(() => guardSettingsFrom({ MCP_CONFIRM: "off" })).toThrow(/not one of client, elicit, none/);
    expect(guardSettingsFrom({})).toEqual({ maxAccess: "money", confirm: "client" });
    expect(guardSettingsFrom({ MCP_CLIENT_MAX_ACCESS: " anaf-spv=read , x=write," })).toEqual({
      maxAccess: "money",
      confirm: "client",
      clientMaxAccess: { "anaf-spv": "read", x: "write" },
    });
    expect(() => guardSettingsFrom({ MCP_CLIENT_MAX_ACCESS: "anaf-spv=admin" })).toThrow(/not <client>=<read\|write\|money>/);
    expect(() => guardSettingsFrom({ MCP_CLIENT_MAX_ACCESS: "read" })).toThrow(/MCP_CLIENT_MAX_ACCESS/);
  });

  it("leaves a money tool unmarked with MCP_CONFIRM=none, and does not mark one asked by elicitation twice", async () => {
    for (const confirm of ["none", "elicit"] as const) {
      const pay = (await (await connect({ maxAccess: "money", confirm })).client.listTools()).tools.find((t) => t.name === "pay_it");
      expect(pay?._meta).toEqual({ [ACCESS_META]: "money" });
    }
  });
});

describe("guard, a write a person approves (confirm: true)", () => {
  const printPolicy: ToolPolicy = {
    print_it: { access: "write", confirm: true, summary: (args) => `print ${String(args["copies"])} copies` },
  };
  const printed: number[] = [];
  const connectPrint = async (settings: GuardSettings, capabilities: ClientCapabilities = {}) => {
    const lines: string[] = [];
    const server = new McpServer({ name: "t", version: "0" });
    guard(server, { service: "svc", policy: printPolicy, settings, log: (l) => lines.push(l) }).registerTool(
      "print_it",
      { description: "prints.", inputSchema: { copies: z.number() } },
      handled(async ({ copies }: { copies: number }) => {
        printed.push(copies);
        return { printed: copies };
      }),
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a as Transport);
    const client = new Client({ name: "c", version: "0" }, { capabilities });
    await client.connect(b as Transport);
    const tool = async () => (await client.listTools()).tools.find((t) => t.name === "print_it");
    return { client, tool, audit: () => lines.map((l) => JSON.parse(l.replace(/^audit /, "")) as Record<string, unknown>) };
  };
  beforeEach(() => {
    printed.length = 0;
  });

  it("is marked for the client to ask, like money, while staying a write", async () => {
    const { client, tool, audit } = await connectPrint(ALL);
    const listed = await tool();
    expect(listed?._meta).toEqual({ [ACCESS_META]: "write", [REQUIRES_USER_META]: true });
    expect(listed?.annotations).toMatchObject({ readOnlyHint: false });
    expect(listed?.annotations?.destructiveHint).toBeUndefined();
    expect(listed?.description).toBe("prints. Acts outside the computer: the client asks the user to approve each call.");
    expect(parse(await client.callTool({ name: "print_it", arguments: { copies: 2 } }))).toEqual({ printed: 2 });
    expect(audit()[0]).toMatchObject({ tool: "print_it", access: "write", outcome: "ok" });
  });

  it("is asked by elicitation with its line, and runs under a write ceiling", async () => {
    const { client, audit } = await connectPrint({ maxAccess: "write", confirm: "elicit" }, { elicitation: {} });
    const prompts: string[] = [];
    client.setRequestHandler("elicitation/create", async (request) => {
      prompts.push(request.params.message);
      return { action: "accept", content: { confirm: prompts.length === 1 } };
    });
    expect(parse(await client.callTool({ name: "print_it", arguments: { copies: 1 } }))).toEqual({ printed: 1 });
    expect(parse(await client.callTool({ name: "print_it", arguments: { copies: 9 } }))).toMatchObject({ error: { kind: "confirmation_denied" } });
    expect(printed).toEqual([1]);
    expect(prompts).toEqual(["Confirm? svc: print 1 copies", "Confirm? svc: print 9 copies"]);
    expect(audit().filter((l) => l["outcome"] !== "asked").map((l) => l["confirmed"])).toEqual(["elicit", undefined]);
  });

  it("is refused under a read ceiling, and left unmarked with MCP_CONFIRM=none", async () => {
    const read = await connectPrint({ maxAccess: "read", confirm: "client" });
    expect(parse(await read.client.callTool({ name: "print_it", arguments: { copies: 1 } }))).toMatchObject({ error: { kind: "access_denied", access: "write" } });
    const none = await connectPrint({ maxAccess: "money", confirm: "none" });
    expect((await none.tool())?._meta).toEqual({ [ACCESS_META]: "write" });
    expect((await none.tool())?.description).toBe("prints. Acts outside the computer: confirm with the user before each call.");
    expect(printed).toEqual([]);
  });
});

describe("guard, a money tool that names a file", () => {
  // The user confirms a line read from a file's bytes; the call must run on those bytes.
  const run = async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-resolve-"));
    const ran: string[] = [];
    const filePolicy: ToolPolicy = {
      file_it: {
        access: "money",
        summary: (args) => `file invoice ${String(args["xml"]).slice(0, 12)}`,
        resolve: async ({ xml_path, ...rest }) =>
          typeof xml_path === "string" && xml_path !== ""
            ? { ...rest, xml: (await readInputFile({ path: xml_path }, { roots: [dir] })).bytes.toString("utf8") }
            : rest,
      },
    };
    const server = new McpServer({ name: "t", version: "0" });
    guard(server, { service: "anaf", policy: filePolicy, settings: { maxAccess: "money", confirm: "elicit" }, log: () => {} }).registerTool(
      "file_it",
      { description: "files", inputSchema: { xml: z.string().default(""), xml_path: z.string().default("") } },
      handled(async ({ xml }: { xml: string }) => {
        ran.push(xml);
        return { filed: xml };
      }),
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a as Transport);
    const client = new Client({ name: "c", version: "0" }, { capabilities: { elicitation: {} } });
    const prompts: string[] = [];
    client.setRequestHandler("elicitation/create", async (request) => {
      prompts.push(request.params.message);
      return { action: "accept", content: { confirm: true } };
    });
    await client.connect(b as Transport);
    return { dir, client, ran, prompts, done: () => rm(dir, { recursive: true, force: true }) };
  };

  it("asks and runs on the file's content as the user confirmed it", async () => {
    const { dir, client, ran, prompts, done } = await run();
    await writeFile(join(dir, "a.xml"), "<Invoice>A-1</Invoice>");
    expect(parse(await client.callTool({ name: "file_it", arguments: { xml_path: "a.xml" } }))).toEqual({ filed: "<Invoice>A-1</Invoice>" });
    expect(prompts).toEqual(["Confirm? anaf: file invoice <Invoice>A-1"]);
    expect(ran).toEqual(["<Invoice>A-1</Invoice>"]);
    await done();
  });

  it("refuses to run when the file changed between the question and the answer", async () => {
    const { dir, client, ran, done } = await run();
    await writeFile(join(dir, "a.xml"), "<Invoice>A-1</Invoice>");
    client.setRequestHandler("elicitation/create", async () => {
      await writeFile(join(dir, "a.xml"), "<Invoice>B-2</Invoice>");
      return { action: "accept", content: { confirm: true } };
    });
    expect(parse(await client.callTool({ name: "file_it", arguments: { xml_path: "a.xml" } }))).toMatchObject({ error: { kind: "confirmation_invalid" } });
    expect(ran).toEqual([]);
    await done();
  });

  it("fails a file it cannot take before the user is asked", async () => {
    const { client, ran, prompts, done } = await run();
    const result = await client.callTool({ name: "file_it", arguments: { xml_path: "/etc/passwd" } });
    expect(parse(result)).toMatchObject({ error: { kind: "input", code: "outside_roots", remedy: expect.any(String) } });
    expect(prompts).toEqual([]);
    expect(ran).toEqual([]);
    await done();
  });
});

describe("guard, a money tool whose resolve fails", () => {
  // A resolve that looks something up can fail in the server's own words (nothing found, an argument
  // refused). That happens before the tool's envelope, so the guard reports it with the server's vocabulary.
  const connectResolving = async (vocabulary: boolean) => {
    const lookupPolicy: ToolPolicy = {
      run_it: { access: "money", summary: () => "run it", resolve: async () => kit.fail({ kind: "not_found", message: "no such workflow" }) },
    };
    const server = new McpServer({ name: "t", version: "0" });
    guard(server, {
      service: "svc",
      policy: lookupPolicy,
      log: () => {},
      ...(vocabulary ? { vocabulary: { asAppError: kit.asAppError, remedyFor: () => "look elsewhere" } } : {}),
    }).registerTool("run_it", { description: "runs", inputSchema: { name: z.string() } }, handled(async () => ({ ran: true })));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a as Transport);
    const client = new Client({ name: "c", version: "0" });
    await client.connect(b as Transport);
    return client;
  };

  it("reports the failure in the server's words", async () => {
    const client = await connectResolving(true);
    expect(parse(await client.callTool({ name: "run_it", arguments: { name: "x" } }))).toEqual({
      error: { kind: "not_found", message: "no such workflow", remedy: "look elsewhere" },
    });
  });

  it("calls it unexpected when the server gave no vocabulary", async () => {
    const client = await connectResolving(false);
    expect(parse(await client.callTool({ name: "run_it", arguments: { name: "x" } }))).toMatchObject({ error: { kind: "unexpected" } });
  });
});

describe("guard, a tool with an output schema", () => {
  const answers: unknown[] = [];
  const connectTyped = async () => {
    const lines: string[] = [];
    const server = new McpServer({ name: "t", version: "0" });
    const guarded = guard(server, { service: "svc", policy: { rate_it: { access: "read" }, plain_it: { access: "read" } }, log: (l) => lines.push(l) });
    guarded.registerTool(
      "rate_it",
      { description: "a rate", inputSchema: {}, outputSchema: { currency: z.string(), rate: z.string().regex(/^\d+\.\d+$/), note: z.string().optional() } },
      handled(async () => {
        const next = answers.shift();
        return next instanceof Error ? kit.fail({ kind: "not_found", message: next.message }) : next;
      }),
    );
    guarded.registerTool("plain_it", { description: "plain", inputSchema: {} }, handled(async () => ({ any: "thing" })));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a as Transport);
    const client = new Client({ name: "c", version: "0" });
    await client.connect(b as Transport);
    return { client, audit: () => lines.map((l) => JSON.parse(l.replace(/^audit /, "")) as Record<string, unknown>) };
  };
  beforeEach(() => {
    answers.length = 0;
  });

  it("lists the schema, strict, and sends the JSON as structured content beside the same text", async () => {
    const { client } = await connectTyped();
    const listed = (await client.listTools()).tools;
    expect(listed.find((t) => t.name === "rate_it")?.outputSchema).toMatchObject({ type: "object", required: ["currency", "rate"], additionalProperties: false });
    expect(listed.find((t) => t.name === "plain_it")?.outputSchema).toBeUndefined();
    answers.push({ currency: "EUR", rate: "5.0910" });
    const result = await client.callTool({ name: "rate_it", arguments: {} });
    expect(result.structuredContent).toEqual({ currency: "EUR", rate: "5.0910" });
    expect(parse(result)).toEqual(result.structuredContent);
    expect((await client.callTool({ name: "plain_it", arguments: {} })).structuredContent).toBeUndefined();
  });

  it("answers a result that drifts from its schema as unexpected, in the usual failure shape", async () => {
    const { client, audit } = await connectTyped();
    answers.push({ currency: "EUR", rate: 5.091 }, { currency: "EUR", rate: "5.0910", extra: "x" });
    for (const _ of [1, 2]) {
      const result = await client.callTool({ name: "rate_it", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(parse(result)).toMatchObject({ error: { kind: "unexpected", message: expect.stringContaining("rate_it's result does not match its output schema"), remedy: "report this; it is a bug" } });
    }
    expect(audit().map((l) => l["outcome"])).toEqual(["unexpected", "unexpected"]);
  });

  it("passes a failure as it is, with no structured content", async () => {
    const { client } = await connectTyped();
    answers.push(new Error("no rate that day"));
    const result = await client.callTool({ name: "rate_it", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(parse(result)).toEqual({ error: { kind: "not_found", message: "no rate that day", remedy: "look elsewhere" } });
  });
});

describe("guard, a long call", () => {
  const connectLong = async () => {
    const lines: string[] = [];
    const server = new McpServer({ name: "t", version: "0" });
    const guarded = guard(server, { service: "svc", policy: { count_it: { access: "read" }, wait_it: { access: "read" } }, log: (l) => lines.push(l) });
    guarded.registerTool(
      "count_it",
      { description: "counts", inputSchema: {} },
      handled(async () => {
        for (const n of [1, 2, 3]) reportProgress(n, 3, `step ${n}`);
        return { counted: 3 };
      }),
    );
    guarded.registerTool(
      "wait_it",
      { description: "waits", inputSchema: {} },
      handled(async () => {
        await pause(60_000, () => new Promise(() => undefined), "the wait was not finished");
        return { waited: true };
      }),
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a as Transport);
    const client = new Client({ name: "c", version: "0" });
    await client.connect(b as Transport);
    return { client, audit: () => lines.map((l) => JSON.parse(l.replace(/^audit /, "")) as Record<string, unknown>) };
  };

  it("tells a client that asked how far along it is, the first and the last step at least", async () => {
    const { client } = await connectLong();
    const heard: unknown[] = [];
    const result = await client.callTool({ name: "count_it", arguments: {} }, { onprogress: (p) => void heard.push(p) });
    expect(parse(result)).toEqual({ counted: 3 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(heard).toEqual([
      { progress: 1, total: 3, message: "step 1" },
      { progress: 3, total: 3, message: "step 3" },
    ]);
  });

  it("stops when the client cancels, and audits the call as cancelled", async () => {
    const { client, audit } = await connectLong();
    const controller = new AbortController();
    const pending = client.callTool({ name: "wait_it", arguments: {} }, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort("changed my mind");
    await expect(pending).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(audit()).toEqual([expect.objectContaining({ tool: "wait_it", outcome: "cancelled" })]);
  });
});

describe("checkPolicy", () => {
  it("names what is registered", () => {
    expect(registeredNames(register)).toEqual(["read_it", "lose_it", "pay_it"]);
  });

  it("refuses a tool the policy forgot, and a policy naming a tool nobody registers", () => {
    expect(() => checkPolicy("t", register, { read_it: { access: "read" }, lose_it: { access: "write" } })).toThrow(/missing from the policy: pay_it/);
    expect(() => checkPolicy("t", register, { ...policy, ghost: { access: "read" } })).toThrow(/nobody registers: ghost/);
    expect(() => checkPolicy("t", register, policy)).not.toThrow();
  });
});
