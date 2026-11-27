import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, InMemoryTransport, type Transport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { makeHandled } from "../src/envelope.js";
import { makeErrorKit } from "../src/errors.js";
import type { ToolPolicy } from "../src/policy.js";
import { serve, type Served } from "../src/serve.js";
import { approvalsSettingsFrom, askApproval, type ApprovalsSettings } from "../src/serve/approvals.js";
import { describeSettings, type GuardSettings, guardSettingsFrom } from "../src/serve/confirm.js";
import { guard } from "../src/serve/guard.js";

/**
 * An approval service of the shape MCP_CONFIRM=approvals speaks, served by the
 * kit itself: `request` files a question, `await` answers the next status the
 * test scripted for its line, `cancel` withdraws it.
 */
type Filed = { id: string; action: string; title: string; timeout: number; meta: Record<string, unknown> | undefined; statuses: string[]; cancelled: boolean };
const filed: Filed[] = [];
/** What each question's line is answered, in order, one status per wait; the last one stays. */
const script = new Map<string, string[]>();
const answer = (text: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(text) }] });

const registerService = (server: McpServer): void => {
  server.registerTool(
    "file_it",
    { description: "files", inputSchema: { connector: z.literal("approve"), title: z.string(), params: z.object({ action: z.string() }), timeout_sec: z.number() } },
    async ({ title, params, timeout_sec }: { title: string; params: { action: string }; timeout_sec: number }, ctx: unknown) => {
      if (params.action.includes("refuse me")) return answer({ error: { kind: "bad_param", message: "no such thing" } });
      const job: Filed = {
        id: `ew_${filed.length + 1}`,
        action: params.action,
        title,
        timeout: timeout_sec,
        meta: (ctx as { mcpReq?: { _meta?: Record<string, unknown> } }).mcpReq?._meta,
        statuses: [...(script.get(params.action) ?? ["pending"])],
        cancelled: false,
      };
      filed.push(job);
      return answer({ id: job.id, status: "pending" });
    },
  );
  server.registerTool("wait_it", { description: "waits", inputSchema: { id: z.string(), timeout_sec: z.number() } }, async ({ id }: { id: string }) => {
    const job = filed.find((j) => j.id === id);
    if (job === undefined) return answer({ error: { kind: "not_found" } });
    const status = job.statuses.length > 1 ? (job.statuses.shift() as string) : (job.statuses[0] as string);
    return answer({ id, status });
  });
  server.registerTool("drop_it", { description: "cancels", inputSchema: { id: z.string() } }, async ({ id }: { id: string }) => {
    const job = filed.find((j) => j.id === id);
    if (job !== undefined) job.cancelled = true;
    return answer({ id, status: "cancelled" });
  });
};

type E = { kind: "not_found"; message: string };
const kit = makeErrorKit<E>("approvals-test");
const handled = makeHandled<E>({ asAppError: kit.asAppError, remedyFor: () => "" });

const policy: ToolPolicy = {
  read_it: { access: "read" },
  pay_it: { access: "money", summary: (args) => `pay ${String(args["amount"])} RON\nto ${String(args["to"])}` },
  print_it: { access: "write", confirm: true, summary: (args) => `print ${String(args["copies"])} copies` },
};

const effects: string[] = [];
const register = (server: McpServer): void => {
  server.registerTool("read_it", { description: "reads", inputSchema: {} }, handled(async () => ({ read: true })));
  server.registerTool(
    "pay_it",
    { description: "pays.", inputSchema: { amount: z.string(), to: z.string() } },
    handled(async ({ amount, to }: { amount: string; to: string }) => {
      effects.push(`${amount}->${to}`);
      return { paid: amount };
    }),
  );
  server.registerTool(
    "print_it",
    { description: "prints.", inputSchema: { copies: z.number() } },
    handled(async ({ copies }: { copies: number }) => {
      effects.push(`print ${copies}`);
      return { printed: copies };
    }),
  );
};

let service: Served;
let dir: string;
let approvals: ApprovalsSettings;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "approvals-"));
  const serviceToken = join(dir, "service-token");
  await writeFile(serviceToken, "a-service-token-of-enough-length-0123456789\n");
  service = await serve({
    name: "approver",
    version: "0.0.0",
    register: registerService,
    policy: { file_it: { access: "read" }, wait_it: { access: "read" }, drop_it: { access: "read" } },
    env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: serviceToken },
    log: () => undefined,
  });
  approvals = {
    url: new URL(`http://127.0.0.1:${service.port}/mcp`),
    tokenFile: serviceToken,
    timeoutSec: 60,
    tools: { request: "file_it", await: "wait_it", cancel: "drop_it" },
    requesterMeta: "example/requester",
  };
});

afterAll(() => service.close());

beforeEach(() => {
  effects.length = 0;
  filed.length = 0;
  script.clear();
});

const connect = async (settings: GuardSettings) => {
  const lines: string[] = [];
  const server = new McpServer({ name: "t", version: "0" });
  register(guard(server, { service: "svc", policy, settings, log: (l) => lines.push(l) }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a as Transport);
  const client = new Client({ name: "c", version: "0" });
  await client.connect(b as Transport);
  const audit = () => lines.map((l) => JSON.parse(l.replace(/^audit /, "")) as Record<string, unknown>);
  return { client, audit };
};

const parse = (result: unknown) => JSON.parse((result as { content: [{ text: string }] }).content[0].text) as Record<string, unknown>;
const settingsWith = (over: Partial<ApprovalsSettings> = {}): GuardSettings => ({ maxAccess: "money", confirm: "approvals", approvals: { ...approvals, ...over } });

describe("guard, a money call approved by a person through an approval service (MCP_CONFIRM=approvals)", () => {
  it("asks the service with the policy's line, waits through pending answers, and runs on a yes", async () => {
    script.set("svc: pay 10.00 RON to x", ["pending", "pending", "done"]);
    const { client, audit } = await connect(settingsWith());
    expect(parse(await client.callTool({ name: "pay_it", arguments: { amount: "10.00", to: "x" } }))).toEqual({ paid: "10.00" });
    expect(effects).toEqual(["10.00->x"]);
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({ action: "svc: pay 10.00 RON to x", title: "Approve: svc: pay 10.00 RON to x", timeout: 60, cancelled: false });
    expect(filed[0]?.meta?.["example/requester"]).toMatchObject({
      client: "svc",
      session: "stdio",
      title: "svc pay_it",
      extra: { tool: "pay_it", caller: "stdio", args_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(audit()).toEqual([expect.objectContaining({ tool: "pay_it", outcome: "ok", confirmed: "approvals" })]);
  });

  it("refuses on a no, and on any other answer than a yes, running nothing", async () => {
    script.set("svc: pay 1 RON to x", ["denied"]);
    script.set("svc: pay 2 RON to x", ["expired"]);
    script.set("svc: pay 3 RON to x", ["approved"]);
    const { client, audit } = await connect(settingsWith());
    expect(parse(await client.callTool({ name: "pay_it", arguments: { amount: "1", to: "x" } }))).toMatchObject({ error: { kind: "confirmation_denied", message: expect.stringContaining("denied") } });
    expect(parse(await client.callTool({ name: "pay_it", arguments: { amount: "2", to: "x" } }))).toMatchObject({ error: { kind: "confirmation_denied", message: expect.stringContaining("expired") } });
    expect(parse(await client.callTool({ name: "pay_it", arguments: { amount: "3", to: "x" } }))).toEqual({ paid: "3" });
    expect(effects).toEqual(["3->x"]);
    expect(audit().map((l) => [l["outcome"], l["confirmed"]])).toEqual([
      ["confirmation_denied", undefined],
      ["confirmation_denied", undefined],
      ["ok", "approvals"],
    ]);
  });

  it("confirms a write its policy marks confirm the same way, and leaves other tools alone", async () => {
    script.set("svc: print 2 copies", ["done"]);
    const { client } = await connect(settingsWith());
    expect(parse(await client.callTool({ name: "read_it", arguments: {} }))).toEqual({ read: true });
    expect(parse(await client.callTool({ name: "print_it", arguments: { copies: 2 } }))).toEqual({ printed: 2 });
    expect(filed.map((j) => j.action)).toEqual(["svc: print 2 copies"]);
  });

  it("refuses when the service cannot be asked: unreachable, a token it cannot read, or an error it answers", async () => {
    const unreachable = await connect(settingsWith({ url: new URL("http://127.0.0.1:9/mcp") }));
    expect(parse(await unreachable.client.callTool({ name: "pay_it", arguments: { amount: "1", to: "x" } }))).toMatchObject({ error: { kind: "confirmation_unavailable" } });
    const tokenless = await connect(settingsWith({ tokenFile: join(dir, "missing") }));
    expect(parse(await tokenless.client.callTool({ name: "pay_it", arguments: { amount: "1", to: "x" } }))).toMatchObject({
      error: { kind: "confirmation_unavailable", message: expect.stringContaining("MCP_APPROVALS_TOKEN_FILE cannot be read") },
    });
    const wrongToken = join(dir, "wrong-token");
    await writeFile(wrongToken, "not-the-token\n");
    const refusedToken = await connect(settingsWith({ tokenFile: wrongToken }));
    expect(parse(await refusedToken.client.callTool({ name: "pay_it", arguments: { amount: "1", to: "x" } }))).toMatchObject({ error: { kind: "confirmation_unavailable" } });
    const { client } = await connect(settingsWith());
    expect(parse(await client.callTool({ name: "pay_it", arguments: { amount: "1", to: "refuse me" } }))).toMatchObject({
      error: { kind: "confirmation_unavailable", message: expect.stringContaining("bad_param") },
    });
    expect(effects).toEqual([]);
  });

  it("says in each tool's description that a person approves its calls, and marks nothing for the client", async () => {
    const { client } = await connect(settingsWith());
    const pay = (await client.listTools()).tools.find((t) => t.name === "pay_it");
    expect(pay?.description).toBe("pays. Moves money or makes a legal document: the server asks a person to approve each call on their own device, and waits for the answer before it runs.");
    expect(pay?._meta).not.toHaveProperty(["anthropic/requiresUserInteraction"]);
  });
});

describe("askApproval", () => {
  const ask = { service: "svc", tool: "pay_it", client: "agent", line: "svc: pay 5 RON", argsDigest: "0".repeat(64) };

  it("withdraws a question nobody answered in time, and refuses", async () => {
    let t = 0;
    const now = () => (t += 25_000);
    expect(await askApproval({ ...approvals, timeoutSec: 60 }, ask, undefined, undefined, now)).toEqual({ kind: "refused", message: "nobody answered within 60 s" });
    expect(filed).toHaveLength(1);
    expect(filed[0]?.cancelled).toBe(true);
  });

  it("withdraws the question when the call is cancelled while it waits", async () => {
    const abort = new AbortController();
    const waiting = askApproval(approvals, ask, abort.signal);
    setTimeout(() => abort.abort(), 200);
    expect(await waiting).toMatchObject({ kind: "refused", message: expect.stringContaining("cancelled") });
    expect(filed[0]?.cancelled).toBe(true);
  });

  it("tells progress that the call is waiting", async () => {
    script.set("svc: pay 5 RON", ["pending", "done"]);
    const heard: (string | undefined)[] = [];
    expect(await askApproval(approvals, ask, undefined, (_p, _t, message) => heard.push(message))).toEqual({ kind: "approved" });
    expect(heard[0]).toBe("waiting for a person to approve this call");
    expect(filed[0]?.cancelled).toBe(false);
  });
});

describe("the approvals settings", () => {
  const base = { MCP_CONFIRM: "approvals", MCP_APPROVALS_URL: "https://approvals.example.com/mcp", MCP_APPROVALS_TOKEN_FILE: "/run/secrets/approvals-token" };

  it("reads the service, the token file, the wait, the tool names and the requester key", () => {
    expect(guardSettingsFrom(base)).toEqual({
      maxAccess: "money",
      confirm: "approvals",
      approvals: { url: new URL(base.MCP_APPROVALS_URL), tokenFile: base.MCP_APPROVALS_TOKEN_FILE, timeoutSec: 600, tools: { request: "request", await: "await", cancel: "cancel" } },
    });
    expect(
      approvalsSettingsFrom({ ...base, MCP_APPROVALS_TIMEOUT_S: "300", MCP_APPROVALS_TOOLS: "ask_request, ask_await, ask_cancel", MCP_APPROVALS_REQUESTER_META: "example/requester" }),
    ).toMatchObject({ timeoutSec: 300, tools: { request: "ask_request", await: "ask_await", cancel: "ask_cancel" }, requesterMeta: "example/requester" });
    expect(describeSettings(guardSettingsFrom(base))).toBe("every tool enabled; money and confirmed calls approved by a person through https://approvals.example.com (600 s to answer)");
  });

  it("will not start without what it needs, or with a setting that does not read", () => {
    expect(() => guardSettingsFrom({ MCP_CONFIRM: "approvals" })).toThrow(/MCP_APPROVALS_URL/);
    expect(() => guardSettingsFrom({ ...base, MCP_APPROVALS_TOKEN_FILE: "" })).toThrow(/MCP_APPROVALS_TOKEN_FILE/);
    expect(() => guardSettingsFrom({ ...base, MCP_APPROVALS_URL: "ftp://x/mcp" })).toThrow(/not an http or https URL/);
    expect(() => guardSettingsFrom({ ...base, MCP_APPROVALS_URL: "https://u:p@x/mcp" })).toThrow(/user or password/);
    expect(() => guardSettingsFrom({ ...base, MCP_APPROVALS_TIMEOUT_S: "5" })).toThrow(/from 30 to 3600/);
    expect(() => guardSettingsFrom({ ...base, MCP_APPROVALS_TOOLS: "a,b" })).toThrow(/three tool names/);
    expect(() => guardSettingsFrom({ ...base, MCP_APPROVALS_REQUESTER_META: "has space" })).toThrow(/_meta key/);
    expect(() => guardSettingsFrom({ MCP_CONFIRM: "off" })).toThrow(/not one of client, elicit, approvals, none/);
  });

  it("refuses to listen when a call could outwait the listener's own timeout", async () => {
    const tokenFile = join(dir, "listen-token");
    await writeFile(tokenFile, "a-listener-token-of-enough-length-0123456789\n");
    await expect(
      serve({ name: "slow", version: "0", register, policy, env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: tokenFile, ...base, MCP_APPROVALS_TIMEOUT_S: "900" }, log: () => undefined }),
    ).rejects.toThrow(/MCP_APPROVALS_TIMEOUT_S/);
  });
});
