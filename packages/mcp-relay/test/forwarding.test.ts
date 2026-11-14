import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fakeUpstream, relayTo, relayToken, sha256, startWorld, upstreamToken, type Seen, type World } from "./harness.js";

/** The files below a folder, relative to it; folders that hold none do not count. */
const entries = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1)).sort();

const headers = { authorization: `Bearer ${relayToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
const post = (url: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> =>
  fetch(url, { method: "POST", headers: { ...headers, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) });

const toolCall = (id: number, name: string, args: unknown) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const answerWith = (id: number, content: unknown[]) => ({ jsonrpc: "2.0", id, result: { content } });
const json = (res: import("node:http").ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => {
  res.writeHead(status, { "content-type": "application/json", ...extra }).end(JSON.stringify(body));
};

describe("what the relay sends the upstream, and what it passes back", () => {
  it("presents its own token and the MCP headers, and nothing else of the client's", async () => {
    const upstream = await fakeUpstream((_req, res) => json(res, 200, { jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "sess-9", "set-cookie": "a=b", "x-internal": "no" }));
    const relay = await relayTo(upstream.url);
    try {
      const body = '{"jsonrpc":"2.0",  "id":1,"method":"tools/list"}';
      const answer = await post(relay.url, body, {
        "mcp-protocol-version": "2025-11-25",
        "mcp-session-id": "sess-1",
        "mcp-method": "tools/list",
        "last-event-id": "41",
        cookie: "session=1",
        "x-forwarded-for": "192.0.2.5",
      });
      expect(answer.status).toBe(200);
      expect(answer.headers.get("mcp-session-id")).toBe("sess-9");
      expect(answer.headers.get("set-cookie")).toBeNull();
      expect(answer.headers.get("x-internal")).toBeNull();
      expect(answer.headers.get("content-type")).toBe("application/json");
      const [seen] = upstream.seen as [Seen];
      expect(seen.method).toBe("POST");
      expect(seen.url).toBe("/mcp");
      expect(seen.body.toString()).toBe(body);
      expect(seen.headers["authorization"]).toBe(`Bearer ${upstreamToken}`);
      expect(seen.headers["mcp-protocol-version"]).toBe("2025-11-25");
      expect(seen.headers["mcp-session-id"]).toBe("sess-1");
      expect(seen.headers["mcp-method"]).toBe("tools/list");
      expect(seen.headers["last-event-id"]).toBe("41");
      expect(seen.headers["accept"]).toBe("application/json, text/event-stream");
      expect(seen.headers["content-type"]).toBe("application/json");
      expect(seen.headers["cookie"]).toBeUndefined();
      expect(seen.headers["x-forwarded-for"]).toBeUndefined();
      expect(JSON.stringify(seen.headers)).not.toContain(relayToken);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("forwards GET and DELETE as they are, and an empty answer as an empty answer", async () => {
    const upstream = await fakeUpstream((req, res) => {
      if (req.method === "DELETE") return void res.writeHead(202).end();
      json(res, 200, { got: req.method });
    });
    const relay = await relayTo(upstream.url);
    try {
      const get = await fetch(relay.url, { method: "GET", headers: { authorization: headers.authorization, accept: "text/event-stream", "last-event-id": "3" } });
      expect(get.status).toBe(200);
      expect(await get.json()).toEqual({ got: "GET" });
      const del = await fetch(relay.url, { method: "DELETE", headers: { authorization: headers.authorization, "mcp-session-id": "sess-1" } });
      expect(del.status).toBe(202);
      expect(await del.text()).toBe("");
      expect(upstream.seen.map((s) => [s.method, s.url, s.headers["last-event-id"], s.headers["mcp-session-id"], s.body.length])).toEqual([
        ["GET", "/mcp", "3", undefined, 0],
        ["DELETE", "/mcp", undefined, "sess-1", 0],
      ]);
      expect(upstream.seen.every((s) => s.headers["authorization"] === `Bearer ${upstreamToken}`)).toBe(true);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("sends a stream on as it comes, event by event, and keeps its comments, ids and line ends", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const first = ': connected\n\nid: 1\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n';
    const second = 'id: 2\r\nevent: message\r\ndata: {"jsonrpc":"2.0","id":5,"result":{"content":[{"type":"text","text":"mentions resource_link only in words"}]}}\r\n\r\n';
    const upstream = await fakeUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(first);
      void gate.then(() => res.end(second));
    });
    const relay = await relayTo(upstream.url);
    try {
      const answer = await fetch(relay.url, { method: "GET", headers: { authorization: headers.authorization, accept: "text/event-stream" } });
      expect(answer.headers.get("content-type")).toBe("text/event-stream");
      const reader = (answer.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let got = "";
      // The first event reaches this client while the upstream is still holding the second back.
      while (!got.includes("notifications/progress")) got += decoder.decode((await reader.read()).value, { stream: true });
      expect(got).toBe(first);
      open();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) got += decoder.decode(chunk.value, { stream: true });
      expect(got).toBe(first + second);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("fetches the file in a stream's event with a link before that event, and sends the other events as they were", async () => {
    const uri = (dir: string): string => `file://${dir}/streamed.txt`;
    let outDir = "";
    const upstream = await fakeUpstream((req, res) => {
      if (req.url?.startsWith("/files/outbox/")) return void res.writeHead(200, { "content-length": "7", "x-content-sha256": sha256("payload") }).end("payload");
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(': ping\n\n');
      res.write(`id: 7\r\ndata: ${JSON.stringify(answerWith(1, [{ type: "resource_link", uri: uri(outDir), name: "streamed.txt" }]))}\r\n\r\n`);
      res.end('data: {"jsonrpc":"2.0","method":"notifications/message","params":{"data":"resource_link"}}\n\n');
    });
    const relay = await relayTo(upstream.url);
    outDir = relay.localOut;
    try {
      const answer = await post(relay.url, toolCall(1, "x", {}));
      const events = (await answer.text()).split(/\r?\n\r?\n/).filter((e) => e !== "");
      expect(events).toHaveLength(3);
      expect(events[0]).toBe(": ping");
      expect(events[1]).toContain("id: 7");
      expect(events[1]).toContain(uri(relay.localOut));
      expect(events[2]).toBe('data: {"jsonrpc":"2.0","method":"notifications/message","params":{"data":"resource_link"}}');
      expect(await readFile(join(relay.localOut, "streamed.txt"), "utf8")).toBe("payload");
      expect(upstream.seen.filter((s) => s.url.startsWith("/files/outbox/")).map((s) => s.url)).toEqual(["/files/outbox/streamed.txt"]);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("the relay as a client sees it, next to the server itself", () => {
  let world: World;
  beforeAll(async () => {
    world = await startWorld();
  });
  afterAll(() => world.close());

  type Reply = { readonly status: number; readonly body: string; readonly type: string | undefined; readonly allow: string | undefined };
  const ask = (url: string, method: string, path: string, extra: Record<string, string>): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      const req = request({ host: target.hostname, port: target.port, method, path, headers: extra }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), type: res.headers["content-type"], allow: res.headers["allow"] }));
      });
      req.on("error", reject);
      req.end();
    });

  it.each([
    ["without a token", "POST", "/mcp", {}],
    ["with a token that is not one", "POST", "/mcp", { authorization: "Bearer not-a-token-0123456789" }],
    ["with another Host", "POST", "/mcp", { authorization: "TOKEN", host: "evil.example" }],
    ["to another route", "POST", "/other", { authorization: "TOKEN" }],
    ["to the file routes, which are not a client's", "GET", "/files/outbox/a.txt", { authorization: "TOKEN" }],
  ] as const)("answers a request %s as the server does", async (_what, method, path, given) => {
    const extra: Record<string, string> = given;
    const toRelay = await ask(world.relayUrl, method, path, { ...extra, ...(extra.authorization === "TOKEN" ? { authorization: `Bearer ${relayToken}` } : {}) });
    const toServer = await ask(world.upstreamUrl, method, path, { ...extra, ...(extra.authorization === "TOKEN" ? { authorization: `Bearer ${upstreamToken}` } : {}) });
    expect(toRelay).toEqual(toServer);
  });

  it("refuses a method it does not forward, where the server would refuse every one but POST", async () => {
    for (const method of ["PUT", "PATCH", "OPTIONS"]) {
      const answer = await ask(world.relayUrl, method, "/mcp", { authorization: `Bearer ${relayToken}` });
      expect(answer.status).toBe(405);
    }
  });

  it("passes on the server's own answer to a GET, which a stateless server refuses", async () => {
    const answer = await ask(world.relayUrl, "GET", "/mcp", { authorization: `Bearer ${relayToken}` });
    expect(answer.status).toBe(405);
    expect(answer.body).toContain("the upstream answered 405");
    expect(answer.body).toContain("stateless server: POST only");
  });
});

describe("a relay with limits of its own", () => {
  it("refuses a body over the limit and a client over its rate, as a server does", async () => {
    const upstream = await fakeUpstream((_req, res) => json(res, 200, { jsonrpc: "2.0", id: 1, result: {} }));
    const relay = await relayTo(upstream.url, { env: { MCP_HTTP_MAX_BODY: "200", MCP_HTTP_RATE: "1/4" } });
    try {
      const big = await post(relay.url, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(400) } }));
      expect(big.status).toBe(413);
      expect(await big.text()).toBe("body larger than 200 bytes\n");
      const statuses: number[] = [];
      for (let i = 0; i < 8; i += 1) statuses.push((await post(relay.url, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status);
      expect(statuses).toContain(429);
      const limited = await post(relay.url, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(limited.headers.get("retry-after")).not.toBeNull();
      expect(upstream.seen.length).toBeLessThan(8);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("never reaches the upstream for a client without a token", async () => {
    const upstream = await fakeUpstream((_req, res) => json(res, 200, {}));
    const relay = await relayTo(upstream.url);
    try {
      expect((await fetch(relay.url, { method: "POST", body: "{}" })).status).toBe(401);
      expect((await fetch(relay.url, { method: "POST", headers: { authorization: `Bearer ${upstreamToken}` }, body: "{}" })).status).toBe(401);
      expect(upstream.seen).toEqual([]);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("an upstream that fails", () => {
  const tools = { jsonrpc: "2.0", id: 1, method: "tools/list" };

  it("is unreachable: a bad gateway that says why", async () => {
    const relay = await relayTo("http://127.0.0.1:1");
    try {
      const answer = await post(relay.url, tools);
      expect(answer.status).toBe(502);
      expect(await answer.text()).toBe("the upstream could not be reached (ECONNREFUSED)\n");
    } finally {
      await relay.close();
    }
  });

  it("refuses the relay's token: a bad gateway, never a 401 that would send the client to sign in, and the token is not in the words", async () => {
    for (const status of [401, 403]) {
      const upstream = await fakeUpstream((_req, res) => res.writeHead(status, { "content-type": "text/plain" }).end(`no: ${upstreamToken} is not good enough\n`));
      const relay = await relayTo(upstream.url);
      try {
        const answer = await post(relay.url, tools);
        expect(answer.status).toBe(502);
        const text = await answer.text();
        expect(text).toContain(`the upstream refused the relay's token (${status})`);
        expect(text).toContain("MCP_RELAY_UPSTREAM_TOKEN_FILE");
        expect(text).not.toContain(upstreamToken);
        expect(text).toContain("[token]");
      } finally {
        await relay.close();
        await upstream.close();
      }
    }
  });

  it.each([
    [500, "internal error\n", 500, "the upstream failed (500): internal error"],
    [503, "", 503, "the upstream failed (503)"],
    [404, "not found\n", 404, "the upstream answered 404: is MCP_RELAY_UPSTREAM the base URL of the server?: not found"],
    [421, "wrong host\n", 421, "(421)"],
    [413, "body larger than 5 bytes\n", 413, "refused the request as too large (413)"],
  ])("answers %s: the same status, in words that name the upstream", async (status, body, expected, words) => {
    const upstream = await fakeUpstream((_req, res) => res.writeHead(status, { "content-type": "text/plain" }).end(body));
    const relay = await relayTo(upstream.url);
    try {
      const answer = await post(relay.url, tools);
      expect(answer.status).toBe(expected);
      expect(await answer.text()).toContain(words);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("limits the rate: the same wait the upstream asked for", async () => {
    const upstream = await fakeUpstream((_req, res) => res.writeHead(429, { "retry-after": "7" }).end("too many requests\n"));
    const relay = await relayTo(upstream.url);
    try {
      const answer = await post(relay.url, tools);
      expect(answer.status).toBe(429);
      expect(answer.headers.get("retry-after")).toBe("7");
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("hangs up in the middle of a stream: the stream ends, and the client is not left waiting", async () => {
    const upstream = await fakeUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: one\n\n");
      setTimeout(() => res.destroy(), 30);
    });
    const relay = await relayTo(upstream.url);
    try {
      const answer = await post(relay.url, tools);
      const text = await answer.text().catch(() => "broken");
      expect(["data: one\n\n", "broken"]).toContain(text);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("a file the relay cannot send up", () => {
  const upload = async (
    handle: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, seen: Seen) => void,
    env: Record<string, string> = {},
    content: string | Buffer = "contents of the scan",
    file = "scan one.pdf",
  ) => {
    const upstream = await fakeUpstream((req, res, seen) => {
      if (req.method === "PUT") return handle(req, res, seen);
      json(res, 200, answerWith(1, [{ type: "text", text: "called" }]));
    });
    const relay = await relayTo(upstream.url, { env });
    await writeFile(join(relay.localIn, file), content);
    const answer = await (await post(relay.url, toolCall(1, "read", { path: join(relay.localIn, file) }))).json();
    return { upstream, relay, answer: answer as { error?: { code: number; message: string }; result?: unknown }, path: join(relay.localIn, file), done: async () => { await relay.close(); await upstream.close(); } };
  };

  it("sends it as the server's endpoint wants it: its path below the inbox, escaped, its length and its hash", async () => {
    const content = "contents of the scan";
    const run = await upload((_req, res) => json(res, 200, { path: "", size: content.length, sha256: sha256(content) }), {}, content, "scan one.pdf");
    try {
      const put = run.upstream.seen.find((s) => s.method === "PUT") as Seen;
      expect(put.url).toBe("/files/inbox/scan%20one.pdf");
      expect(put.body.toString()).toBe(content);
      expect(put.headers["content-length"]).toBe(String(content.length));
      expect(put.headers["x-content-sha256"]).toBe(sha256(content));
      expect(put.headers["authorization"]).toBe(`Bearer ${upstreamToken}`);
      expect(put.headers["content-type"]).toBe("application/octet-stream");
      expect(run.upstream.seen.map((s) => s.method)).toEqual(["PUT", "POST"]);
    } finally {
      await run.done();
    }
  });

  it("is refused for the relay's token: the call fails and names the file, the reason, and not the token", async () => {
    const run = await upload((_req, res) => res.writeHead(401).end(`unauthorized ${upstreamToken}\n`));
    try {
      expect(run.answer.error?.code).toBe(-32000);
      expect(run.answer.error?.message).toContain(run.path);
      expect(run.answer.error?.message).toContain("the upstream refused the relay's token (401)");
      expect(JSON.stringify(run.answer)).not.toContain(upstreamToken);
      expect(JSON.stringify(run.answer)).not.toContain("contents of the scan");
      expect(run.upstream.seen.map((s) => s.method)).toEqual(["PUT"]);
    } finally {
      await run.done();
    }
  });

  it.each([
    ["too large", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(413).end("file larger than 10 bytes\n"), /too large \(413\)/],
    ["is not found", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(404).end("not found\n"), /answered 404: its file endpoint is off/],
    ["is not stored whole", (_req: unknown, res: import("node:http").ServerResponse) => json(res, 200, { path: "/x", size: 3, sha256: sha256("abc") }), /stored other bytes than were sent/],
    ["is answered with something else", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(200).end("ok"), /not what its file endpoint sends/],
    ["is answered by a hang-up", (_req: unknown, res: import("node:http").ServerResponse) => res.destroy(), /could not be reached \(the connection was closed before the answer\)/],
    ["is refused on a checksum", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(422).end("checksum mismatch\n"), /other bytes than were sent \(422\)/],
  ])("fails the call when the upstream says it %s", async (_what, handle, words) => {
    const run = await upload(handle);
    try {
      expect(run.answer.error?.message).toContain(run.path);
      expect(run.answer.error?.message).toMatch(words);
      expect(run.upstream.seen.some((s) => s.method === "POST")).toBe(false);
    } finally {
      await run.done();
    }
  });

  it("is over the relay's own limit: not sent at all", async () => {
    const run = await upload((_req, res) => json(res, 200, {}), { MCP_RELAY_MAX_FILE_BYTES: "10" });
    try {
      expect(run.answer.error?.message).toContain("over the relay's limit of 10 bytes (MCP_RELAY_MAX_FILE_BYTES)");
      expect(run.upstream.seen).toEqual([]);
    } finally {
      await run.done();
    }
  });

  it("goes on without it when a batch holds other calls, which the server still answers", async () => {
    const seenCalls: unknown[] = [];
    const upstream = await fakeUpstream((req, res, seen) => {
      if (req.method === "PUT") return void res.writeHead(req.url?.includes("bad") ? 413 : 200, { "content-type": "application/json" }).end(req.url?.includes("bad") ? "no" : JSON.stringify({ path: "", size: 2, sha256: sha256("ok") }));
      const calls = JSON.parse(seen.body.toString()) as { id: number }[];
      seenCalls.push(...calls);
      json(res, 200, calls.map((c) => answerWith(c.id, [{ type: "text", text: `answered ${c.id}` }])));
    });
    const relay = await relayTo(upstream.url);
    try {
      await writeFile(join(relay.localIn, "good.txt"), "ok");
      await writeFile(join(relay.localIn, "bad.txt"), "no");
      const answer = (await (await post(relay.url, [toolCall(1, "read", { path: join(relay.localIn, "good.txt") }), toolCall(2, "read", { path: join(relay.localIn, "bad.txt") }), toolCall(3, "none", {})])).json()) as { id: number; error?: { message: string }; result?: unknown }[];
      expect(seenCalls.map((c) => (c as { id: number }).id)).toEqual([1, 3]);
      expect(answer.map((m) => m.id).sort()).toEqual([1, 2, 3]);
      expect(answer.find((m) => m.id === 2)?.error?.message).toContain("bad.txt");
      expect(answer.filter((m) => m.error === undefined)).toHaveLength(2);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("a file the relay cannot bring down", () => {
  const link = (dir: string, name: string): unknown[] => [{ type: "text", text: "saved" }, { type: "resource_link", uri: `file://${dir}/${name}`, name }];

  const download = async (file: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void, env: Record<string, string> = {}, name = "out/report 1.pdf") => {
    let dir = "";
    const upstream = await fakeUpstream((req, res) => {
      if (req.url?.startsWith("/files/outbox/")) return file(req, res);
      json(res, 200, answerWith(1, link(dir, name)));
    });
    const relay = await relayTo(upstream.url, { env });
    dir = relay.localOut;
    const answer = (await (await post(relay.url, toolCall(1, "save", {}))).json()) as { result: { content: { type: string; text?: string; uri?: string }[] } };
    return { upstream, relay, content: answer.result.content, note: answer.result.content.at(2)?.text, path: join(relay.localOut, name), done: async () => { await relay.close(); await upstream.close(); } };
  };
  const body = "the bytes of the report";

  it("is fetched by its escaped path, with the relay's token, and kept whole", async () => {
    const run = await download((_req, res) => res.writeHead(200, { "content-length": String(body.length), "x-content-sha256": sha256(body), "content-type": "application/pdf" }).end(body));
    try {
      expect(run.content).toHaveLength(2);
      expect(await readFile(run.path, "utf8")).toBe(body);
      const get = run.upstream.seen.find((s) => s.url.startsWith("/files/"));
      expect(get?.method).toBe("GET");
      expect(get?.url).toBe("/files/outbox/out/report%201.pdf");
      expect(get?.headers["authorization"]).toBe(`Bearer ${upstreamToken}`);
    } finally {
      await run.done();
    }
  });

  it.each([
    ["arrives damaged", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(200, { "content-length": String(body.length), "x-content-sha256": sha256("other bytes") }).end(body), /arrived damaged/],
    ["comes without a checksum", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(200, { "content-length": String(body.length) }).end(body), /without its checksum/],
    ["comes with a checksum that is not one", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(200, { "content-length": String(body.length), "x-content-sha256": "abc" }).end(body), /without its checksum/],
    [
      "is cut short",
      (_req: unknown, res: import("node:http").ServerResponse) => {
        res.writeHead(200, { "content-length": "500", "x-content-sha256": sha256(body) });
        res.write(body);
        setTimeout(() => res.destroy(), 20);
      },
      /broke off/,
    ],
    ["is not there", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(404).end("not found\n"), /404: its file endpoint is off, or the file is not there \(not found\)/],
    ["fails on the server", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(500).end("internal error\n"), /failed \(500\) \(internal error\)/],
    ["is refused for the relay's token", (_req: unknown, res: import("node:http").ServerResponse) => res.writeHead(401).end(`${upstreamToken}\n`), /refused the relay's token \(401\)/],
  ])("leaves nothing and says so when it %s", async (_what, file, words) => {
    const run = await download(file);
    try {
      // The response still goes through, with its own items first and one more at the end.
      expect(run.content.slice(0, 2)).toEqual(link(run.relay.localOut, "out/report 1.pdf"));
      expect(run.content).toHaveLength(3);
      expect(run.content[2]?.type).toBe("text");
      expect(run.note).toContain(run.path);
      expect(run.note).toMatch(words);
      expect(run.note).not.toContain(upstreamToken);
      expect(await entries(run.relay.localOut)).toEqual([]);
    } finally {
      await run.done();
    }
  });

  it("is larger than the relay's limit: refused by its declared length, and by its real one when the length lies", async () => {
    const declared = await download((_req, res) => res.writeHead(200, { "content-length": "5000", "x-content-sha256": sha256("x") }).end(Buffer.alloc(5000)), { MCP_RELAY_MAX_FILE_BYTES: "100" });
    try {
      expect(declared.note).toMatch(/larger than the relay's limit of 100 bytes/);
      expect(await entries(declared.relay.localOut)).toEqual([]);
    } finally {
      await declared.done();
    }
    const unsaid = await download((_req, res) => res.writeHead(200, { "x-content-sha256": sha256("x") }).end(Buffer.alloc(5000)), { MCP_RELAY_MAX_FILE_BYTES: "100" });
    try {
      expect(unsaid.note).toMatch(/larger than the relay's limit of 100 bytes/);
      expect(await entries(unsaid.relay.localOut)).toEqual([]);
    } finally {
      await unsaid.done();
    }
  });

  it("would go where a file is already, which is replaced whole; and where a folder is, which is not", async () => {
    let dir = "";
    const upstream = await fakeUpstream((req, res) => {
      if (req.url?.startsWith("/files/outbox/")) return void res.writeHead(200, { "content-length": String(body.length), "x-content-sha256": sha256(body) }).end(body);
      json(res, 200, answerWith(1, [...link(dir, "again.txt"), { type: "resource_link", uri: `file://${dir}/a-folder`, name: "a-folder" }]));
    });
    const relay = await relayTo(upstream.url);
    dir = relay.localOut;
    try {
      await writeFile(join(relay.localOut, "again.txt"), "the old bytes");
      await mkdir(join(relay.localOut, "a-folder"));
      const answer = (await (await post(relay.url, toolCall(1, "save", {}))).json()) as { result: { content: { text?: string }[] } };
      expect(await readFile(join(relay.localOut, "again.txt"), "utf8")).toBe(body);
      expect(answer.result.content.at(-1)?.text).toMatch(/a-folder: a folder is where it should go on this machine/);
      expect((await entries(relay.localOut)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("is fetched once when two links name it, and a link in each response of a batch is followed", async () => {
    let dir = "";
    const upstream = await fakeUpstream((req, res) => {
      if (req.url?.startsWith("/files/outbox/")) return void res.writeHead(200, { "content-length": String(body.length), "x-content-sha256": sha256(body) }).end(body);
      json(res, 200, [answerWith(1, [...link(dir, "one.txt"), ...link(dir, "one.txt")]), answerWith(2, link(dir, "two.txt"))]);
    });
    const relay = await relayTo(upstream.url);
    dir = relay.localOut;
    try {
      await post(relay.url, [toolCall(1, "save", {}), toolCall(2, "save", {})]);
      expect(await entries(relay.localOut)).toEqual(["one.txt", "two.txt"]);
      expect(upstream.seen.filter((s) => s.url.startsWith("/files/outbox/")).map((s) => s.url).sort()).toEqual(["/files/outbox/one.txt", "/files/outbox/two.txt"]);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});
