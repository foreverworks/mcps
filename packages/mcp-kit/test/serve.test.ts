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

  it("is public with a list of the hosts a proxy forwards, and the header that carries each caller's address", () => {
    expect(listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com, rates.example.org:8443" })).toEqual({
      kind: "public",
      port: 3000,
      hosts: [
        { name: "rates.example.com", port: 443 },
        { name: "rates.example.org", port: 8443 },
      ],
    });
    expect(listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_HTTP_CLIENT_IP_HEADER: "X-Forwarded-For", MCP_HTTP_TOKENS_DIR: "" })).toEqual({
      kind: "public",
      port: 3000,
      hosts: [{ name: "rates.example.com", port: 443 }],
      clientIpHeader: "x-forwarded-for",
    });
  });

  it("refuses public hosts with tokens, with file roots, without a port, or listing nothing", () => {
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_HTTP_TOKEN_FILE: "/t" })).toThrow(
      /MCP_HTTP_PUBLIC_HOSTS and MCP_HTTP_TOKEN_FILE are both set/,
    );
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_HTTP_TOKENS_DIR: "/d" })).toThrow(/MCP_HTTP_TOKENS_DIR are both set/);
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_FILE_ROOTS: "/srv/inbox" })).toThrow(/anyone could read the files/);
    expect(() => listenFrom({ MCP_HTTP_PUBLIC_HOSTS: "rates.example.com" })).toThrow(/without MCP_HTTP_PORT/);
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: " , " })).toThrow(/names no host/);
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "https://rates.example.com/mcp" })).toThrow(/not a host name/);
  });

  it("refuses a client address header on a server with tokens, where the token tells callers apart", () => {
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_TOKEN_FILE: "/t", MCP_HTTP_CLIENT_IP_HEADER: "x-forwarded-for" })).toThrow(/without MCP_HTTP_PUBLIC_HOSTS/);
  });

  it("takes an empty public host list as unset, as every variable", () => {
    expect(listenFrom({ MCP_HTTP_PUBLIC_HOSTS: "" })).toEqual({ kind: "stdio" });
    expect(listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "", MCP_HTTP_TOKEN_FILE: "/t" })).toMatchObject({ kind: "http" });
  });
});

describe("listenFrom, where it binds", () => {
  const tokens = { MCP_HTTP_PORT: "3000", MCP_HTTP_TOKEN_FILE: "/t" };

  it("binds nothing of its own and allows no extra Host while neither variable is set", () => {
    const listen = listenFrom(tokens);
    expect(listen).not.toHaveProperty("host");
    expect(listen).not.toHaveProperty("allowedHosts");
    const empty = listenFrom({ ...tokens, MCP_HTTP_HOST: " ", MCP_HTTP_ALLOWED_HOSTS: "" });
    expect(empty).toEqual(listen);
    expect(empty).not.toHaveProperty("host");
  });

  it("carries the address to bind and the Host names to answer, with tokens", () => {
    expect(listenFrom({ ...tokens, MCP_HTTP_HOST: "0.0.0.0", MCP_HTTP_ALLOWED_HOSTS: "mcp.internal, svc.example.org:8080" })).toEqual({
      kind: "http",
      port: 3000,
      tokens: { kind: "file", file: "/t", client: "default" },
      host: "0.0.0.0",
      allowedHosts: [
        { name: "mcp.internal", port: undefined },
        { name: "svc.example.org", port: 8080 },
      ],
    });
  });

  it("refuses an address other than a loopback one without the allowed hosts, naming the variable to set", () => {
    for (const host of ["0.0.0.0", "::", "192.0.2.10"]) {
      expect(() => listenFrom({ ...tokens, MCP_HTTP_HOST: host })).toThrow(/MCP_HTTP_HOST "[^"]+" is not a loopback address.*set MCP_HTTP_ALLOWED_HOSTS/);
    }
    expect(() => listenFrom({ ...tokens, MCP_HTTP_HOST: "0.0.0.0", MCP_HTTP_ALLOWED_HOSTS: " " })).toThrow(/set MCP_HTTP_ALLOWED_HOSTS/);
  });

  it("lets a loopback address do without them, and the allowed hosts stand alone on the default one", () => {
    for (const host of ["127.0.0.1", "127.0.0.2", "::1", "localhost"]) expect(listenFrom({ ...tokens, MCP_HTTP_HOST: host })).toMatchObject({ kind: "http", host });
    expect(listenFrom({ ...tokens, MCP_HTTP_ALLOWED_HOSTS: "localhost" })).not.toHaveProperty("host");
  });

  it("takes the public hosts as the names to answer, and the allowed hosts beside them", () => {
    const publicEnv = { MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_HTTP_HOST: "0.0.0.0" };
    expect(listenFrom(publicEnv)).toMatchObject({ kind: "public", host: "0.0.0.0" });
    expect(listenFrom({ ...publicEnv, MCP_HTTP_ALLOWED_HOSTS: "mcp.internal" })).toMatchObject({ kind: "public", allowedHosts: [{ name: "mcp.internal" }] });
  });

  it("refuses an address that is not one, a bad host list, and either variable without a port", () => {
    expect(() => listenFrom({ ...tokens, MCP_HTTP_HOST: "mcp.internal" })).toThrow(/is not an IP address/);
    expect(() => listenFrom({ ...tokens, MCP_HTTP_ALLOWED_HOSTS: "https://mcp.internal" })).toThrow(/MCP_HTTP_ALLOWED_HOSTS entry/);
    expect(() => listenFrom({ MCP_HTTP_HOST: "0.0.0.0" })).toThrow(/MCP_HTTP_HOST is set without MCP_HTTP_PORT/);
    expect(() => listenFrom({ MCP_HTTP_ALLOWED_HOSTS: "mcp.internal" })).toThrow(/MCP_HTTP_ALLOWED_HOSTS is set without MCP_HTTP_PORT/);
    expect(listenFrom({ MCP_HTTP_HOST: "", MCP_HTTP_ALLOWED_HOSTS: " " })).toEqual({ kind: "stdio" });
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

/** A POST to `url` with these headers, as its status: the Host header is the one thing node's fetch will not let a test choose. */
const statusOf = (url: URL, headers: Record<string, string>): Promise<number> =>
  new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
  });

describe("serve over http, with the defaults", () => {
  const token = "test-token-default-0123456789";
  let served: Served;
  let url: URL;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-serve-default-"));
    const tokenFile = join(dir, "token");
    await writeFile(tokenFile, `${token}\n`);
    served = await serve({
      name: "plain",
      version: "0.0.0",
      register: (server: McpServer): void => {
        server.registerTool("ping", { description: "answers pong", inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: "pong" }] }));
      },
      policy: { ping: { access: "read" } },
      env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: tokenFile },
      log: () => undefined,
    });
    url = new URL(`http://127.0.0.1:${served.port}${MCP_PATH}`);
  });

  afterAll(() => served.close());

  it("binds 127.0.0.1 and answers the two loopback Host names of its port and no other", async () => {
    expect(served.address).toBe("127.0.0.1");
    const authorization = `Bearer ${token}`;
    expect(await statusOf(url, { authorization, host: `127.0.0.1:${served.port}` })).toBe(200);
    expect(await statusOf(url, { authorization, host: `localhost:${served.port}` })).toBe(200);
    for (const host of ["localhost", "127.0.0.1", `127.0.0.1:${served.port! + 1}`, "mcp.internal", `mcp.internal:${served.port}`, "[::1]"]) {
      expect(await statusOf(url, { authorization, host })).toBe(421);
    }
  });
});

describe("serve over http, bound for a network", () => {
  const token = "test-token-network-0123456789";
  const other = "other-token-network-0123456789";
  const audit: string[] = [];
  let served: Served;
  let url: URL;
  const startup: string[] = [];

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-serve-network-"));
    await writeFile(join(dir, `token-alice`), `${token}\n`);
    const lines = (...args: unknown[]): void => void startup.push(args.join(" "));
    const original = console.error;
    console.error = lines;
    try {
      served = await serve({
        name: "boxed",
        version: "0.0.0",
        register: (server: McpServer): void => {
          server.registerTool("ping", { description: "answers pong", inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: "pong" }] }));
        },
        policy: { ping: { access: "read" } },
        env: { MCP_HTTP_PORT: "0", MCP_HTTP_HOST: "0.0.0.0", MCP_HTTP_ALLOWED_HOSTS: "mcp.internal, Svc.Example.org:8080", MCP_HTTP_TOKENS_DIR: dir },
        log: (line) => audit.push(line),
      });
    } finally {
      console.error = original;
    }
    url = new URL(`http://127.0.0.1:${served.port}${MCP_PATH}`);
  });

  afterAll(() => served.close());

  const authorization = `Bearer ${token}`;

  it("binds the address it was given, and says so with the Host names it answers", () => {
    expect(served.address).toBe("0.0.0.0");
    expect(startup.join("\n")).toContain(`boxed: listening on http://0.0.0.0:${served.port}${MCP_PATH} for alice, and Host mcp.internal, svc.example.org:8080;`);
  });

  it("answers an allowed Host, with or without its port, in any case", async () => {
    expect(await statusOf(url, { authorization, host: "mcp.internal" })).toBe(200);
    expect(await statusOf(url, { authorization, host: `mcp.internal:${served.port}` })).toBe(200);
    expect(await statusOf(url, { authorization, host: "MCP.Internal:9999" })).toBe(200);
    expect(await statusOf(url, { authorization, host: "svc.example.org:8080" })).toBe(200);
    expect(await statusOf(url, { authorization, host: "SVC.EXAMPLE.ORG:8080" })).toBe(200);
  });

  it("still answers the loopback Host names of its port", async () => {
    expect(await statusOf(url, { authorization, host: `127.0.0.1:${served.port}` })).toBe(200);
    expect(await statusOf(url, { authorization, host: `localhost:${served.port}` })).toBe(200);
  });

  it("refuses with a 421 a Host that is not listed, or whose port is not the listed one", async () => {
    for (const host of ["evil.example", "mcp.internal.evil.example", "svc.example.org", "svc.example.org:9090", `localhost:${served.port! + 1}`, "localhost"]) {
      expect(await statusOf(url, { authorization, host })).toBe(421);
    }
  });

  it("still requires the token, on an allowed Host too, and tells the clients apart", async () => {
    expect(await statusOf(url, { host: "mcp.internal" })).toBe(401);
    expect(await statusOf(url, { authorization: `Bearer ${other}`, host: "mcp.internal" })).toBe(401);
    expect(await statusOf(url, { authorization: "Basic abc", host: "mcp.internal" })).toBe(401);
    const client = testClient("test-client");
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization } } }));
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["ping"]);
    expect(await client.callTool({ name: "ping", arguments: {} })).toMatchObject({ content: [{ type: "text" as const, text: "pong" }] });
    await client.close();
    expect(JSON.parse(audit[0]!.replace(/^audit /, ""))).toMatchObject({ svc: "boxed", tool: "ping", client: "alice", outcome: "ok" });
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

describe("serve over http, public", () => {
  const register = (server: McpServer): void => {
    server.registerTool("ping", { description: "answers pong", inputSchema: {} }, async () => ({
      content: [{ type: "text" as const, text: "pong" }],
    }));
  };
  const env = { MCP_HTTP_PORT: "0", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_HTTP_CLIENT_IP_HEADER: "x-forwarded-for", MCP_HTTP_RATE: "1/8" };
  let served: Served;
  let url: URL;
  const audit: string[] = [];

  beforeAll(async () => {
    served = await serve({ name: "rates", version: "0.0.0", register, policy: { ping: { access: "read" } }, env, log: (line) => audit.push(line) });
    url = new URL(`http://127.0.0.1:${served.port}${MCP_PATH}`);
  });

  afterAll(() => served.close());

  /** A POST as the proxy would forward it: the caller's address in x-forwarded-for, and the public Host. */
  const post = (from: string, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, host = "rates.example.com"): Promise<number> =>
    new Promise((resolve, reject) => {
      const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", host, "x-forwarded-for": from };
      const req = request(url, { method: "POST", headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });

  it("binds to the loopback address only, as a server with tokens does", () => {
    expect(served.address).toBe("127.0.0.1");
  });

  it.each(["legacy", "modern"] as const)("answers initialize, tools/list and tools/call with no Authorization, protocol %s", async (era) => {
    const client = testClient("test-client", era);
    // Each protocol from its own address, so the two do not share a bucket.
    const from = era === "modern" ? "192.0.2.21" : "192.0.2.20";
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { "x-forwarded-for": from } } }));
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["ping"]);
    expect(await client.callTool({ name: "ping", arguments: {} })).toMatchObject({ content: [{ type: "text" as const, text: "pong" }] });
    await client.close();
  });

  it("audits each call as the client `public`, never by address", () => {
    const lines = audit.map((line) => line.replace(/^audit /, ""));
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.parse(lines[0]!)).toMatchObject({ svc: "rates", tool: "ping", client: "public", access: "read", outcome: "ok" });
    expect(lines.join("\n")).not.toMatch(/192\.0\.2\./);
  });

  it("answers the public host with or without its port, and loopback, and refuses another host with a 421", async () => {
    expect(await post("192.0.2.30")).toBe(200);
    expect(await post("192.0.2.30", undefined, "rates.example.com:443")).toBe(200);
    expect(await post("192.0.2.30", undefined, `127.0.0.1:${served.port}`)).toBe(200);
    expect(await post("192.0.2.30", undefined, "evil.example")).toBe(421);
    expect(await post("192.0.2.30", undefined, "rates.example.com:8443")).toBe(421);
  });

  it("limits each caller's address on its own: one over its limit gets 429, another still passes", async () => {
    const first = await Promise.all(Array.from({ length: 12 }, () => post("198.51.100.7")));
    expect(first).toContain(429);
    expect(first.filter((status) => status === 200).length).toBeGreaterThanOrEqual(8);
    // The proxy appended 198.51.100.7 to what the caller sent: the same caller, whatever it wrote before.
    expect(await post("203.0.113.99, 198.51.100.7")).toBe(429);
    expect(await post("198.51.100.8")).toBe(200);
  });

  it("refuses a GET and a CORS preflight, with no CORS headers", async () => {
    const preflight = await fetch(url, { method: "OPTIONS", headers: { origin: "https://page.example", "access-control-request-method": "POST" } });
    expect(preflight.status).toBe(405);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    expect((await fetch(url, { method: "GET" })).status).toBe(405);
  });
});

describe("serve over http, public, with tools that are not reads", () => {
  const register = (server: McpServer): void => {
    for (const name of ["ping", "label", "pay"]) {
      server.registerTool(name, { description: name, inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: name }] }));
    }
  };
  const policy = { ping: { access: "read" }, label: { access: "write" }, pay: { access: "money", summary: () => "pay" } } as const;
  const env = { MCP_HTTP_PORT: "0", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com" };

  it("refuses to start, naming each tool anyone could run", async () => {
    await expect(serve({ name: "mixed", version: "0.0.0", register, policy, env, log: () => undefined })).rejects.toThrow(
      /mixed: MCP_HTTP_PUBLIC_HOSTS serves this server with no sign-in, so anyone can call it, and only read tools may run there; label \(write\), pay \(money\) could/,
    );
    await expect(serve({ name: "mixed", version: "0.0.0", register, policy, env: { ...env, MCP_MAX_ACCESS: "write" }, log: () => undefined })).rejects.toThrow(/label \(write\) could/);
  });

  it("starts under a read ceiling, which refuses every call to the others", async () => {
    const served = await serve({ name: "mixed", version: "0.0.0", register, policy, env: { ...env, MCP_MAX_ACCESS: "read" }, log: () => undefined });
    try {
      const client = testClient("test-client");
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${served.port}${MCP_PATH}`)));
      expect(await client.callTool({ name: "ping", arguments: {} })).toMatchObject({ content: [{ type: "text" as const, text: "ping" }] });
      const paid = (await client.callTool({ name: "pay", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
      expect(paid.isError).toBe(true);
      expect(JSON.parse(paid.content[0]!.text)).toMatchObject({ error: { kind: "access_denied", access: "money", allowed: "read" } });
      await client.close();
    } finally {
      await served.close();
    }
  });
});
