import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { request } from "node:http";

import { type Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { McpServer, ProtocolEra } from "@modelcontextprotocol/server";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pause, PROGRESS_INTERVAL_MS, reportProgress } from "../src/call.js";
import { asksProgress, bearerMatches, clientFor, listenFrom, loadTokens, MCP_PATH, serve, type Served } from "../src/serve.js";
import { testClient } from "../src/smoke.js";

describe("listenFrom", () => {
  it("is stdio unless a port is set", () => {
    expect(listenFrom({})).toEqual({ kind: "stdio" });
    expect(listenFrom({ MCP_HTTP_PORT: " " })).toEqual({ kind: "stdio" });
  });

  it("is http with a port and a token file, for one client", () => {
    expect(listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_TOKEN_FILE: "/t" })).toEqual({
      kind: "http",
      port: 3000,
      tokens: { kind: "file", file: "/t", client: "default" },
    });
  });

  it("prefers a directory of per-client tokens", () => {
    expect(listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_TOKENS_DIR: "/run/credentials/x", MCP_HTTP_TOKEN_FILE: "/t" })).toEqual({
      kind: "http",
      port: 3000,
      tokens: { kind: "dir", dir: "/run/credentials/x" },
    });
  });

  it("refuses http without a token", () => {
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000" })).toThrow(/MCP_HTTP_TOKENS_DIR or MCP_HTTP_TOKEN_FILE/);
  });

  it("refuses a port that is not one", () => {
    expect(() => listenFrom({ MCP_HTTP_PORT: "http", MCP_HTTP_TOKEN_FILE: "/t" })).toThrow(/not a port/);
    expect(() => listenFrom({ MCP_HTTP_PORT: "70000", MCP_HTTP_TOKEN_FILE: "/t" })).toThrow(/not a port/);
  });
});

describe("tokens", () => {
  it("reads token-<client> files and ignores the other credentials beside them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-tokens-"));
    await writeFile(join(dir, "token-alice"), "a".repeat(32) + "\n");
    await writeFile(join(dir, "token-bob"), "b".repeat(32));
    await writeFile(join(dir, "app.json"), "{}");
    const tokens = await loadTokens({ kind: "dir", dir });
    expect([...tokens.keys()]).toEqual(["alice", "bob"]);
    expect(clientFor(`Bearer ${"b".repeat(32)}`, tokens)).toBe("bob");
    expect(clientFor(`Bearer ${"x".repeat(32)}`, tokens)).toBeUndefined();
  });

  it("skips an empty token (a client not configured here), and refuses none at all or a short one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-tokens-"));
    await expect(loadTokens({ kind: "dir", dir })).rejects.toThrow(/no tokens/);
    await mkdir(join(dir, "x"));
    await writeFile(join(dir, "token-old"), "");
    await expect(loadTokens({ kind: "dir", dir })).rejects.toThrow(/no tokens/);
    await writeFile(join(dir, "token-alice"), "a".repeat(20));
    expect([...(await loadTokens({ kind: "dir", dir })).keys()]).toEqual(["alice"]);
    await writeFile(join(dir, "token-bob"), "short");
    await expect(loadTokens({ kind: "dir", dir })).rejects.toThrow(/too short for: bob/);
  });
});

describe("bearerMatches", () => {
  it("takes the exact token and nothing else", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer s3cre", "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
    expect(bearerMatches(undefined, "s3cret")).toBe(false);
  });
});

describe("serve over http", () => {
  const token = "test-token-0123456789";
  const register = (server: McpServer): void => {
    server.registerTool("ping", { description: "answers pong", inputSchema: {} }, async () => ({
      content: [{ type: "text" as const, text: "pong" }],
    }));
  };
  let served: Served;
  let url: URL;
  const audit: string[] = [];

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-serve-"));
    const tokenFile = join(dir, "token");
    await writeFile(tokenFile, `${token}\n`);
    served = await serve({
      name: "test",
      version: "0.0.0",
      register,
      policy: { ping: { access: "read" } },
      env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: tokenFile, MCP_HTTP_MAX_BODY: "2048", MCP_HTTP_RATE: "1/40" },
      log: (line) => audit.push(line),
    });
    url = new URL(`http://127.0.0.1:${served.port}${MCP_PATH}`);
  });

  afterAll(() => served.close());

  const connect = async (era: ProtocolEra = "legacy"): Promise<Client> => {
    const client = testClient("test-client", era);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    return client;
  };

  it("binds to the loopback address only, whatever the port", async () => {
    expect(served.address).toBe("127.0.0.1");
  });

  it.each(["legacy", "modern"] as const)("serves the registered tools to a client of protocol %s", async (era) => {
    const client = await connect(era);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["ping"]);
    expect(await client.callTool({ name: "ping", arguments: {} })).toMatchObject({ content: [{ type: "text" as const, text: "pong" }] });
    expect(client.getNegotiatedProtocolVersion()).toBe(era === "modern" ? "2026-07-28" : "2025-11-25");
    await client.close();
  });

  it.each(["legacy", "modern"] as const)("answers a tool it does not have with a protocol error, protocol %s", async (era) => {
    const client = await connect(era);
    await expect(client.callTool({ name: "pong", arguments: {} })).rejects.toThrow(/Tool pong not found/);
    await client.close();
  });

  it("answers one bare POST, without initialize, with one JSON body, as a script with curl expects", async () => {
    const answer = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ping", arguments: {} } }),
    });
    expect(answer.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await answer.json()).toMatchObject({ id: 1, result: { content: [{ type: "text", text: "pong" }] } });
  });

  it("serves many clients from the one process", async () => {
    const clients = await Promise.all([connect(), connect()]);
    const answers = await Promise.all(clients.map((c) => c.callTool({ name: "ping", arguments: {} })));
    await Promise.all(clients.map((c) => c.close()));
    expect(answers).toEqual([expect.objectContaining({ content: [{ type: "text" as const, text: "pong" }] }), expect.objectContaining({ content: [{ type: "text" as const, text: "pong" }] })]);
  });

  it("audits each call under the client its token names", () => {
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.parse(audit[0]!.replace(/^audit /, ""))).toMatchObject({ svc: "test", tool: "ping", client: "default", access: "read", outcome: "ok" });
  });

  it("refuses a body over the limit, and another Host", async () => {
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(4096) } });
    expect((await fetch(url, { method: "POST", headers, body: big })).status).toBe(413);
    const other = await new Promise<number>((resolve) => {
      const req = request(url, { method: "POST", headers: { ...headers, host: "evil.example:80" } }, (res) => resolve(res.statusCode ?? 0));
      req.end("{}");
    });
    expect(other).toBe(421);
  });

  it("limits each client's rate", async () => {
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const statuses = await Promise.all(Array.from({ length: 45 }, () => fetch(url, { method: "POST", headers, body }).then((r) => r.status)));
    expect(statuses).toContain(429);
  });

  it("turns away a request without the token", async () => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
  });

  it("answers only its one route, and only POST", async () => {
    const authorization = `Bearer ${token}`;
    expect((await fetch(new URL("/other", url), { method: "POST", headers: { authorization } })).status).toBe(404);
    expect((await fetch(url, { method: "GET", headers: { authorization } })).status).toBe(405);
  });
});

describe("serve over http, a long call", () => {
  const token = "test-token-long-0123456789";
  const audit: string[] = [];
  let served: Served;
  let url: URL;
  const register = (server: McpServer): void => {
    server.registerTool("count", { description: "counts slowly", inputSchema: {} }, async () => {
      for (const n of [1, 2, 3]) {
        reportProgress(n, 3, `step ${n}`);
        await new Promise((resolve) => setTimeout(resolve, PROGRESS_INTERVAL_MS + 20));
      }
      return { content: [{ type: "text" as const, text: "3" }] };
    });
    server.registerTool("wait", { description: "waits", inputSchema: {} }, async () => {
      await pause(60_000, () => new Promise(() => undefined), "the wait was not finished");
      return { content: [{ type: "text" as const, text: "waited" }] };
    });
  };

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-serve-long-"));
    const tokenFile = join(dir, "token");
    await writeFile(tokenFile, `${token}\n`);
    served = await serve({
      name: "long",
      version: "0.0.0",
      register,
      policy: { count: { access: "read" }, wait: { access: "read" } },
      env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: tokenFile },
      log: (line) => audit.push(line),
    });
    url = new URL(`http://127.0.0.1:${served.port}${MCP_PATH}`);
  });

  afterAll(() => served.close());

  it.each(["legacy", "modern"] as const)("streams progress to a call that asks for it, protocol %s", async (era) => {
    const client = testClient("test-client", era);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const heard: number[] = [];
    const result = await client.callTool({ name: "count", arguments: {} }, { onprogress: (p) => void heard.push(p.progress) });
    expect(result).toMatchObject({ content: [{ type: "text" as const, text: "3" }] });
    expect(heard).toEqual([1, 2, 3]);
    expect(asksProgress({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "count", _meta: { progressToken: 1 } } })).toBe(true);
    expect(asksProgress([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "count" } }])).toBe(false);
    expect(asksProgress({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { progressToken: 1 } } })).toBe(false);
  });

  it("cancels the call when the client hangs up", async () => {
    const controller = new AbortController();
    const call = fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "wait", arguments: {} } }),
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await call;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(audit.map((l) => JSON.parse(l.replace(/^audit /, "")) as Record<string, unknown>)).toContainEqual(expect.objectContaining({ tool: "wait", outcome: "cancelled" }));
  });
});
