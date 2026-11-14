import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_FILES_MAX_BYTES, fileRouteOf, filesFrom, filesUrlPath, segmentsOf } from "../src/serve/files.js";
import { storeStream } from "../src/fileStream.js";
import { listenFrom, MCP_PATH, serve, type Served } from "../src/serve.js";

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

describe("filesFrom", () => {
  it("is off while neither folder is set, blank or not", () => {
    expect(filesFrom({})).toBeUndefined();
    expect(filesFrom({ MCP_HTTP_FILES_OUTBOX: " ", MCP_HTTP_FILES_INBOX: "" })).toBeUndefined();
  });

  it("turns on only the direction whose folder is set, with a 256 MiB cap unless told another", () => {
    expect(filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out/" })).toEqual({ outbox: "/srv/out", maxBytes: DEFAULT_FILES_MAX_BYTES });
    expect(filesFrom({ MCP_HTTP_FILES_INBOX: "/srv/in" })).toEqual({ inbox: "/srv/in", maxBytes: 256 * 1024 * 1024 });
    expect(filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out", MCP_HTTP_FILES_INBOX: "/srv/in", MCP_HTTP_FILES_MAX_BYTES: " 1024 " })).toEqual({ outbox: "/srv/out", inbox: "/srv/in", maxBytes: 1024 });
  });

  it("refuses a folder that is not written in full, a size that is not a number, and a size with no inbox", () => {
    expect(() => filesFrom({ MCP_HTTP_FILES_OUTBOX: "out" })).toThrow(/MCP_HTTP_FILES_OUTBOX "out" is not an absolute path/);
    expect(() => filesFrom({ MCP_HTTP_FILES_INBOX: "./in" })).toThrow(/MCP_HTTP_FILES_INBOX/);
    for (const bad of ["0", "-5", "1.5", "lots", "1e30"]) {
      expect(() => filesFrom({ MCP_HTTP_FILES_INBOX: "/srv/in", MCP_HTTP_FILES_MAX_BYTES: bad })).toThrow(/is not a number of bytes/);
    }
    expect(() => filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out", MCP_HTTP_FILES_MAX_BYTES: "10" })).toThrow(/without MCP_HTTP_FILES_INBOX/);
  });
});

describe("listenFrom, with the file endpoints", () => {
  const tokens = { MCP_HTTP_PORT: "3000", MCP_HTTP_TOKEN_FILE: "/t" };

  it("carries no files key unless a folder is set", () => {
    expect(listenFrom(tokens)).not.toHaveProperty("files");
    expect(listenFrom({ ...tokens, MCP_HTTP_FILES_OUTBOX: "", MCP_HTTP_FILES_INBOX: " " })).not.toHaveProperty("files");
  });

  it("carries the folders with tokens", () => {
    expect(listenFrom({ ...tokens, MCP_HTTP_FILES_OUTBOX: "/srv/out", MCP_HTTP_TOKENS_DIR: "/d" })).toEqual({
      kind: "http",
      port: 3000,
      tokens: { kind: "dir", dir: "/d" },
      files: { outbox: "/srv/out", maxBytes: DEFAULT_FILES_MAX_BYTES },
    });
    expect(listenFrom({ ...tokens, MCP_HTTP_FILES_INBOX: "/srv/in" })).toMatchObject({ kind: "http", files: { inbox: "/srv/in" } });
  });

  it("stops the start for any of the variables without a port, and for a server that is open to anyone", () => {
    for (const name of ["MCP_HTTP_FILES_OUTBOX", "MCP_HTTP_FILES_INBOX", "MCP_HTTP_FILES_MAX_BYTES"]) {
      expect(() => listenFrom({ [name]: "/srv/x" })).toThrow(new RegExp(`${name} is set without MCP_HTTP_PORT`));
      expect(listenFrom({ [name]: " " })).toEqual({ kind: "stdio" });
    }
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_HTTP_FILES_OUTBOX: "/srv/out" })).toThrow(
      /MCP_HTTP_PUBLIC_HOSTS and MCP_HTTP_FILES_OUTBOX are both set/,
    );
  });
});

describe("the path of a file route", () => {
  it("is the names between the slashes, each decoded once", () => {
    expect(segmentsOf("a.txt")).toEqual(["a.txt"]);
    expect(segmentsOf("2026-09/invoices/a%20b.pdf")).toEqual(["2026-09", "invoices", "a b.pdf"]);
    expect(segmentsOf("%C8%99.txt")).toEqual(["ș.txt"]);
    // Decoded once: what a %25 leaves is a name, not a second encoding to undo.
    expect(segmentsOf("%252e%252e")).toEqual(["%2e%2e"]);
    expect(segmentsOf("...")).toEqual(["..."]);
    expect(segmentsOf("n".repeat(255))).toEqual(["n".repeat(255)]);
    expect(segmentsOf(".hidden")).toEqual([".hidden"]);
  });

  it.each([
    ["nothing", ""],
    ["an empty segment", "a//b"],
    ["a leading slash, which would make it absolute", "/etc/passwd"],
    ["a trailing slash", "a/"],
    ["a dot", "a/./b"],
    ["a dot dot", "../b"],
    ["an encoded dot dot", "%2e%2e/b"],
    ["an upper case encoded dot dot", "a/%2E%2E/b"],
    ["an encoded dot", "a/%2e/b"],
    ["an encoded slash", "a%2Fb"],
    ["an encoded backslash", "a%5Cb"],
    ["a backslash", "a\\b"],
    ["a NUL", "a%00b"],
    ["an encoding that is not UTF-8", "a%FFb"],
    ["a broken escape", "a%zz"],
    ["a name longer than a file system takes", `${"n".repeat(256)}.txt`],
    ["a name of short letters whose bytes are too many", "\u0219".repeat(128)],
  ])("is refused with %s", (_what, rest) => {
    expect(segmentsOf(rest)).toBeUndefined();
  });

  it("is told from other routes on the target as the client wrote it, query and all", () => {
    const both = { outbox: "/o", inbox: "/i", maxBytes: 1 };
    expect(fileRouteOf("/files/outbox/a/b?x=1", both)).toEqual({ direction: "outbox", rest: "a/b" });
    expect(fileRouteOf("/files/inbox/a#frag", both)).toEqual({ direction: "inbox", rest: "a" });
    expect(fileRouteOf("/files/outbox", both)).toEqual({ direction: "outbox", rest: "" });
    expect(fileRouteOf("/files/outbox/../mcp", both)).toEqual({ direction: "outbox", rest: "../mcp" });
    for (const other of ["/files", "/files/", "/files/outboxes/a", "/mcp", "/", "http://host/files/outbox/a", undefined]) expect(fileRouteOf(other, both)).toBeUndefined();
    expect(fileRouteOf("/files/inbox/a", { outbox: "/o", maxBytes: 1 })).toBeUndefined();
    expect(fileRouteOf("/files/outbox/a", { inbox: "/i", maxBytes: 1 })).toBeUndefined();
  });

  it("is built with every name escaped, the inverse of reading it", () => {
    const built = filesUrlPath("/files/outbox", "2026-09/a b#c?d%e.pdf");
    expect(built).toBe("/files/outbox/2026-09/a%20b%23c%3Fd%25e.pdf");
    expect(segmentsOf(built.slice("/files/outbox/".length))).toEqual(["2026-09", "a b#c?d%e.pdf"]);
  });
});

type Answer = { readonly status: number; readonly headers: Record<string, string | string[] | undefined>; readonly body: Buffer };

/** One request exactly as written: Node's fetch would tidy a `..` or a `%2e%2e` away before it left. */
const raw = (
  server: Served,
  method: string,
  target: string,
  { headers = {}, body }: { readonly headers?: Record<string, string>; readonly body?: Buffer | string | readonly Buffer[] } = {},
): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const sized = body === undefined || Array.isArray(body) ? {} : { "content-length": String(Buffer.byteLength(body as Buffer | string)) };
    const req = request({ host: "127.0.0.1", port: server.port, method, path: target, headers: { ...sized, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (Array.isArray(body)) for (const chunk of body as readonly Buffer[]) req.write(chunk);
    else if (body !== undefined) req.write(body);
    req.end();
  });

const ping = (server: McpServer): void => {
  server.registerTool("ping", { description: "answers pong", inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: "pong" }] }));
};

const token = "files-test-token-0123456789";
const auth = { authorization: `Bearer ${token}` };

const start = async (
  name: string,
  env: Record<string, string>,
  log: string[] = [],
): Promise<{ readonly served: Served; readonly base: string; readonly root: string }> => {
  const root = await mkdtemp(join(tmpdir(), "mcp-kit-files-"));
  await writeFile(join(root, "token"), `${token}\n`);
  const served = await serve({
    name,
    version: "0.0.0",
    register: ping,
    policy: { ping: { access: "read" } },
    env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: join(root, "token"), ...env },
    log: (line) => log.push(line),
  });
  return { served, base: root, root };
};

describe("a server with none of the file variables set", () => {
  let served: Served;

  beforeAll(async () => {
    served = (await start("plain", {})).served;
  });
  afterAll(() => served.close());

  const routes: readonly [string, string][] = [
    ["GET", "/files/outbox/report.pdf"],
    ["GET", "/files/outbox/"],
    ["GET", "/files/outbox"],
    ["PUT", "/files/inbox/scan.pdf"],
    ["PUT", "/files/inbox/a/b/c.txt"],
    ["POST", "/files/inbox/scan.pdf"],
    ["DELETE", "/files/outbox/report.pdf"],
    ["GET", "/files"],
  ];

  const sameAsUnknown = async (method: string, target: string, headers: Record<string, string>): Promise<void> => {
    const known = await raw(served, method, "/something/else", { headers });
    const asked = await raw(served, method, target, { headers });
    expect(asked.status).toBe(known.status);
    expect(asked.body.toString()).toBe(known.body.toString());
    const { date: _a, ...askedHeaders } = asked.headers;
    const { date: _b, ...knownHeaders } = known.headers;
    expect(askedHeaders).toEqual(knownHeaders);
  };

  it.each(routes)("answers %s %s as the unknown route it is: 404, not found, plain text", async (method, target) => {
    const answer = await raw(served, method, target, { headers: auth });
    expect(answer.status).toBe(404);
    expect(answer.body.toString()).toBe("not found\n");
    expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
    await sameAsUnknown(method, target, auth);
  });

  it.each(routes)("turns away %s %s without the token, and with another Host, exactly as before", async (method, target) => {
    const noToken = await raw(served, method, target);
    expect(noToken.status).toBe(401);
    expect(noToken.body.toString()).toBe("unauthorized\n");
    const otherHost = await raw(served, method, target, { headers: { ...auth, host: "evil.example" } });
    expect(otherHost.status).toBe(421);
    expect(otherHost.body.toString()).toBe("wrong host\n");
    await sameAsUnknown(method, target, {});
    await sameAsUnknown(method, target, { ...auth, host: "evil.example" });
  });

  it("answers a request target no URL parser takes with a 404, and goes on serving", async () => {
    for (const target of ["//", "///", "//?x", "http://["]) {
      const answer = await raw(served, "GET", target, { headers: auth });
      expect(answer.status).toBe(404);
      expect(answer.body.toString()).toBe("not found\n");
    }
    expect((await raw(served, "POST", "//", { headers: auth, body: "{}" })).status).toBe(404);
    expect((await raw(served, "GET", MCP_PATH, { headers: auth })).status).toBe(405);
  });

  it("closes no connection on a refusal, as before", async () => {
    for (const [method, target, headers] of [["POST", "/mcp", {}], ["GET", "/other", auth], ["GET", "/mcp", auth]] as const) {
      const answer = await raw(served, method, target, { headers });
      expect(answer.headers["connection"]).toBe("keep-alive");
    }
  });

  it("starts as it always did: the same line on stderr, nothing about files", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => void lines.push(args.join(" "));
    let again: Served | undefined;
    try {
      again = (await start("plain", {})).served;
    } finally {
      console.error = original;
      await again?.close();
    }
    expect(lines).toEqual([`plain: listening on http://127.0.0.1:${again?.port}/mcp for default; every tool enabled; money and confirmed calls marked for the client to confirm`]);
    expect(lines.join("\n")).not.toMatch(/files|GET|PUT/);
  });

  it("still serves its one route", async () => {
    const answer = await raw(served, "POST", MCP_PATH, {
      headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ping", arguments: {} } }),
    });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body.toString())).toMatchObject({ id: 1, result: { content: [{ type: "text", text: "pong" }] } });
    expect((await raw(served, "GET", MCP_PATH, { headers: auth })).body.toString()).toBe("stateless server: POST only\n");
  });
});

describe("the outbox endpoint", () => {
  const log: string[] = [];
  let served: Served;
  let outbox: string;
  let outside: string;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-outbox-"));
    outbox = join(dir, "out");
    outside = join(dir, "outside");
    await mkdir(join(outbox, "2026-09", "invoices"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outbox, "report.pdf"), "%PDF-1.7 not really");
    await writeFile(join(outbox, "2026-09", "invoices", "a b #1.csv"), "id,amount\n1,10\n");
    await writeFile(join(outbox, "empty.bin"), "");
    await writeFile(join(outbox, "no-extension"), "plain bytes");
    await writeFile(join(outside, "secret.txt"), "not for you");
    await symlink(join(outside, "secret.txt"), join(outbox, "link-to-secret"));
    await symlink(outside, join(outbox, "link-to-outside"));
    await symlink(join(outbox, "report.pdf"), join(outbox, "link-inside"));
    await mkdir(join(outbox, "folder"));
    served = (await start("outbox", { MCP_HTTP_FILES_OUTBOX: outbox }, log)).served;
  });
  afterAll(() => served.close());

  it("sends a file with its length, its type and its SHA-256", async () => {
    const answer = await raw(served, "GET", "/files/outbox/report.pdf", { headers: auth });
    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe("%PDF-1.7 not really");
    expect(answer.headers["content-length"]).toBe(String(answer.body.length));
    expect(answer.headers["content-type"]).toBe("application/pdf");
    expect(answer.headers["x-content-sha256"]).toBe(sha256("%PDF-1.7 not really"));
  });

  it("finds a file in a folder by a percent-encoded name, and knows no type it was not told", async () => {
    const csv = await raw(served, "GET", `/files/outbox/${filesUrlPath("/files/outbox", "2026-09/invoices/a b #1.csv").slice("/files/outbox/".length)}`, { headers: auth });
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toBe("text/csv");
    expect(csv.body.toString()).toBe("id,amount\n1,10\n");
    const bare = await raw(served, "GET", "/files/outbox/no-extension", { headers: auth });
    expect(bare.headers["content-type"]).toBe("application/octet-stream");
  });

  it("sends an empty file, whose SHA-256 is the empty one", async () => {
    const answer = await raw(served, "GET", "/files/outbox/empty.bin", { headers: auth });
    expect(answer.status).toBe(200);
    expect(answer.headers["content-length"]).toBe("0");
    expect(answer.headers["x-content-sha256"]).toBe(sha256(""));
    expect(answer.body.length).toBe(0);
  });

  it("follows a link that stays inside the folder", async () => {
    const answer = await raw(served, "GET", "/files/outbox/link-inside", { headers: auth });
    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe("%PDF-1.7 not really");
  });

  it.each([
    ["a file that is not there", "/files/outbox/missing.pdf"],
    ["a folder", "/files/outbox/folder"],
    ["the folder itself", "/files/outbox/"],
    ["a trailing slash on a file", "/files/outbox/report.pdf/"],
    ["a dot dot", "/files/outbox/../outside/secret.txt"],
    ["a dot dot below a folder", "/files/outbox/2026-09/../../outside/secret.txt"],
    ["an encoded dot dot", "/files/outbox/%2e%2e/outside/secret.txt"],
    ["an encoded slash", "/files/outbox/2026-09%2Finvoices%2Fa%20b%20%231.csv"],
    ["a backslash", "/files/outbox/2026-09\\invoices\\a"],
    ["an empty segment", "/files/outbox//report.pdf"],
    ["an absolute path", "/files/outbox//etc/passwd"],
    ["a NUL", "/files/outbox/report.pdf%00.txt"],
    ["a link to a file outside", "/files/outbox/link-to-secret"],
    ["a path through a link to a folder outside", "/files/outbox/link-to-outside/secret.txt"],
  ])("answers %s with the one generic 404", async (_what, target) => {
    const answer = await raw(served, "GET", target, { headers: auth });
    expect(answer.status).toBe(404);
    expect(answer.body.toString()).toBe("not found\n");
    expect(answer.body.toString()).not.toMatch(/secret|outside|link/);
  });

  it("takes GET only", async () => {
    for (const method of ["PUT", "POST", "DELETE"]) {
      const answer = await raw(served, method, "/files/outbox/report.pdf", { headers: auth, body: "x" });
      expect(answer.status).toBe(405);
      expect(answer.headers["allow"]).toBe("GET");
    }
  });

  it("has no inbox, which is an unknown route", async () => {
    const answer = await raw(served, "PUT", "/files/inbox/a.txt", { headers: auth, body: "x" });
    expect(answer.status).toBe(404);
    expect(answer.body.toString()).toBe("not found\n");
  });

  it("needs the same token and Host as the one route", async () => {
    expect((await raw(served, "GET", "/files/outbox/report.pdf")).status).toBe(401);
    expect((await raw(served, "GET", "/files/outbox/report.pdf", { headers: { authorization: "Bearer wrong-token-0123456789" } })).status).toBe(401);
    expect((await raw(served, "GET", "/files/outbox/report.pdf", { headers: { ...auth, host: "evil.example" } })).status).toBe(421);
  });

  it("writes one line for each file, with its size and a prefix of its hash, and never its bytes", () => {
    const lines = log.filter((line) => line.startsWith("files "));
    const sent = lines.map((line) => JSON.parse(line.slice("files ".length)) as Record<string, unknown>).find((l) => l["path"] === "report.pdf");
    expect(sent).toEqual({ svc: "outbox", client: "default", direction: "download", outcome: "ok", path: "report.pdf", size: 19, sha256: sha256("%PDF-1.7 not really").slice(0, 12) });
    expect(lines.join("\n")).not.toMatch(/not really|secret/);
  });

  it("states itself on the startup line", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => void lines.push(args.join(" "));
    let again: Served | undefined;
    try {
      again = (await start("outbox", { MCP_HTTP_FILES_OUTBOX: outbox })).served;
    } finally {
      console.error = original;
      await again?.close();
    }
    expect(lines.join("\n")).toContain(`; GET /files/outbox/ reads ${outbox}; every tool enabled`);
  });
});

describe("the inbox endpoint", () => {
  const log: string[] = [];
  let served: Served;
  let inbox: string;
  let outside: string;
  const put = (target: string, body: Buffer | string | readonly Buffer[], headers: Record<string, string> = {}): Promise<Answer> =>
    raw(served, "PUT", target, { headers: { ...auth, ...headers }, body });
  const entries = async (dir: string): Promise<string[]> => (await readdir(dir, { recursive: true })).sort();

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-inbox-"));
    inbox = join(dir, "in");
    outside = join(dir, "outside");
    await mkdir(inbox);
    await mkdir(outside);
    await symlink(outside, join(inbox, "link-to-outside"));
    await mkdir(join(inbox, "folder"));
    served = (await start("inbox", { MCP_HTTP_FILES_INBOX: inbox, MCP_HTTP_FILES_MAX_BYTES: "1024" }, log)).served;
  });
  afterAll(() => served.close());

  it("writes a file where its path says, and answers with the path on the server, its size and its SHA-256", async () => {
    const body = Buffer.from("scanned pages");
    const answer = await put("/files/inbox/scan.pdf", body, { "x-content-sha256": sha256(body) });
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toMatch(/^application\/json/);
    expect(JSON.parse(answer.body.toString())).toEqual({ path: join(inbox, "scan.pdf"), size: 13, sha256: sha256(body) });
    expect(await readFile(join(inbox, "scan.pdf"), "utf8")).toBe("scanned pages");
  });

  it("makes the folders it needs, with a mode that keeps the world out", async () => {
    const answer = await put("/files/inbox/2026-09/receipts/a%20b.png", "png bytes");
    expect(JSON.parse(answer.body.toString())).toMatchObject({ path: join(inbox, "2026-09", "receipts", "a b.png"), size: 9 });
    expect(await readFile(join(inbox, "2026-09", "receipts", "a b.png"), "utf8")).toBe("png bytes");
    expect((await stat(join(inbox, "2026-09", "receipts", "a b.png"))).mode & ~0o640).toBe(0o100000);
    expect((await stat(join(inbox, "2026-09"))).mode & 0o007).toBe(0);
  });

  it("replaces a file whole, and leaves no temporary file behind", async () => {
    await put("/files/inbox/replaced.txt", "first");
    await put("/files/inbox/replaced.txt", "second, longer");
    expect(await readFile(join(inbox, "replaced.txt"), "utf8")).toBe("second, longer");
    expect((await entries(inbox)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("takes an empty file, and a body sent in chunks", async () => {
    expect(JSON.parse((await put("/files/inbox/empty.bin", "")).body.toString())).toMatchObject({ size: 0, sha256: sha256("") });
    const chunked = await put("/files/inbox/chunked.txt", [Buffer.from("one,"), Buffer.from("two,"), Buffer.from("three")]);
    expect(JSON.parse(chunked.body.toString())).toMatchObject({ size: 13, sha256: sha256("one,two,three") });
  });

  it("refuses bytes that are not the ones the sender hashed, and keeps nothing", async () => {
    const before = await entries(inbox);
    const answer = await put("/files/inbox/damaged.txt", "what arrived", { "x-content-sha256": sha256("what was sent") });
    expect(answer.status).toBe(422);
    expect(answer.body.toString()).toBe("checksum mismatch\n");
    expect(await entries(inbox)).toEqual(before);
    // A mismatch over a file that was there leaves that file as it was.
    await put("/files/inbox/kept.txt", "kept");
    const again = await put("/files/inbox/kept.txt", "overwritten", { "x-content-sha256": sha256("something else") });
    expect(again.status).toBe(422);
    expect(await readFile(join(inbox, "kept.txt"), "utf8")).toBe("kept");
  });

  it("takes the hash in either case, and refuses one that is not a hash", async () => {
    expect((await put("/files/inbox/upper.txt", "x", { "x-content-sha256": sha256("x").toUpperCase() })).status).toBe(200);
    const bad = await put("/files/inbox/bad.txt", "x", { "x-content-sha256": "abc123" });
    expect(bad.status).toBe(400);
    expect((await entries(inbox)).includes("bad.txt")).toBe(false);
  });

  it("refuses a file over the cap, declared or not, and keeps nothing", async () => {
    const before = await entries(inbox);
    const declared = await put("/files/inbox/big.bin", Buffer.alloc(2048));
    expect(declared.status).toBe(413);
    expect(declared.body.toString()).toBe("file larger than 1024 bytes\n");
    const streamed = await put("/files/inbox/bigger.bin", [Buffer.alloc(600), Buffer.alloc(600)]);
    expect(streamed.status).toBe(413);
    expect(await entries(inbox)).toEqual(before);
    const exact = await put("/files/inbox/exact.bin", Buffer.alloc(1024));
    expect(exact.status).toBe(200);
  });

  it.each([
    ["a dot dot", "/files/inbox/../outside/x.txt"],
    ["a dot dot below a folder", "/files/inbox/folder/../../outside/x.txt"],
    ["an encoded dot dot", "/files/inbox/%2e%2e/outside/x.txt"],
    ["an encoded slash", "/files/inbox/folder%2F..%2F..%2Foutside%2Fx.txt"],
    ["a backslash", "/files/inbox/folder\\x.txt"],
    ["an empty segment", "/files/inbox/folder//x.txt"],
    ["an absolute path", "/files/inbox//tmp/x.txt"],
    ["a NUL", "/files/inbox/x.txt%00.png"],
    ["a trailing slash", "/files/inbox/x.txt/"],
    ["no name", "/files/inbox/"],
    ["a link to a folder outside", "/files/inbox/link-to-outside/x.txt"],
    ["a new folder below a link to a folder outside", "/files/inbox/link-to-outside/new/x.txt"],
  ])("refuses %s with the generic 404, and writes nothing outside", async (_what, target) => {
    const answer = await put(target, "payload");
    expect(answer.status).toBe(404);
    expect(answer.body.toString()).toBe("not found\n");
    expect((await entries(outside)).filter((name) => !name.startsWith("target"))).toEqual([]);
  });

  it("keeps nothing of an upload the client gave up on halfway", async () => {
    const before = await entries(inbox);
    await new Promise<void>((resolve) => {
      const req = request({ host: "127.0.0.1", port: served.port, method: "PUT", path: "/files/inbox/halfway.bin", headers: { ...auth, "content-length": "1000" } });
      req.on("error", () => resolve());
      req.write(Buffer.alloc(100));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 50);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await entries(inbox)).toEqual(before);
  });

  it("refuses a name too long for the file system, with the generic 404", async () => {
    const answer = await put(`/files/inbox/${"n".repeat(300)}.txt`, "x");
    expect(answer.status).toBe(404);
  });

  it("refuses to write over a folder", async () => {
    const answer = await put("/files/inbox/folder", "payload");
    expect(answer.status).toBe(409);
    expect((await stat(join(inbox, "folder"))).isDirectory()).toBe(true);
  });

  it("refuses a name below a file as a folder", async () => {
    await put("/files/inbox/plain.txt", "a file");
    expect((await put("/files/inbox/plain.txt/inside.txt", "payload")).status).toBe(404);
  });

  it("replaces a link with the file, never writing through it", async () => {
    await writeFile(join(outside, "target.txt"), "outside file");
    await symlink(join(outside, "target.txt"), join(inbox, "link-to-file"));
    expect((await put("/files/inbox/link-to-file", "new bytes")).status).toBe(200);
    expect(await readFile(join(outside, "target.txt"), "utf8")).toBe("outside file");
    expect(await readFile(join(inbox, "link-to-file"), "utf8")).toBe("new bytes");
  });

  it("takes PUT only, and has no outbox", async () => {
    const answer = await raw(served, "GET", "/files/inbox/scan.pdf", { headers: auth });
    expect(answer.status).toBe(405);
    expect(answer.headers["allow"]).toBe("PUT");
    expect((await raw(served, "GET", "/files/outbox/scan.pdf", { headers: auth })).status).toBe(404);
  });

  it("needs the same token and Host as the one route", async () => {
    expect((await raw(served, "PUT", "/files/inbox/anon.txt", { body: "x" })).status).toBe(401);
    expect((await raw(served, "PUT", "/files/inbox/anon.txt", { headers: { authorization: "Bearer wrong-token-0123456789" }, body: "x" })).status).toBe(401);
    expect((await raw(served, "PUT", "/files/inbox/anon.txt", { headers: { ...auth, host: "evil.example" }, body: "x" })).status).toBe(421);
    expect((await entries(inbox)).includes("anon.txt")).toBe(false);
  });

  it("writes one line for each file, never its bytes", () => {
    const lines = log.filter((line) => line.startsWith("files ")).map((line) => JSON.parse(line.slice("files ".length)) as Record<string, unknown>);
    expect(lines).toContainEqual({ svc: "inbox", client: "default", direction: "upload", outcome: "ok", path: "scan.pdf", size: 13, sha256: sha256("scanned pages").slice(0, 12) });
    expect(lines).toContainEqual({ svc: "inbox", client: "default", direction: "upload", outcome: "checksum_mismatch" });
    expect(JSON.stringify(lines)).not.toMatch(/scanned pages|what arrived/);
  });
});

describe("a file moved from one server to another", () => {
  it("arrives byte for byte, binary included", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-roundtrip-"));
    const inbox = join(dir, "in");
    const { served } = await start("both", { MCP_HTTP_FILES_INBOX: inbox, MCP_HTTP_FILES_OUTBOX: inbox, MCP_HTTP_FILES_MAX_BYTES: String(4 * 1024 * 1024) });
    try {
      const bytes = Buffer.alloc(3 * 1024 * 1024 + 17);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
      const up = await raw(served, "PUT", "/files/inbox/blob.bin", { headers: auth, body: bytes });
      expect(JSON.parse(up.body.toString())).toMatchObject({ size: bytes.length, sha256: sha256(bytes) });
      const down = await raw(served, "GET", "/files/outbox/blob.bin", { headers: auth });
      expect(down.body.equals(bytes)).toBe(true);
      expect(down.headers["x-content-sha256"]).toBe(sha256(bytes));
    } finally {
      await served.close();
    }
  });
});

describe("a server with an inbox, and the requests that have not signed in", () => {
  let served: Served;
  let inbox: string;
  const entries = async (dir: string): Promise<string[]> => (await readdir(dir, { recursive: true })).sort();

  beforeAll(async () => {
    inbox = join(await mkdtemp(join(tmpdir(), "mcp-kit-bounds-")), "in");
    await mkdir(inbox);
    served = (await start("bounds", { MCP_HTTP_FILES_INBOX: inbox, MCP_HTTP_TIMEOUT_MS: "800" })).served;
  });
  afterAll(() => served.close());

  /** What a socket does when it sends `head` and then goes quiet: the first line of the answer, and whether the server closed the connection. */
  const quiet = (head: string, waitMs: number): Promise<{ readonly first: string; readonly closed: boolean; readonly after: number }> =>
    new Promise((resolve) => {
      const started = Date.now();
      const socket = connect(served.port as number, "127.0.0.1");
      let text = "";
      let closed = false;
      socket.on("data", (chunk) => (text += chunk.toString()));
      socket.on("close", () => (closed = true));
      socket.on("error", () => (closed = true));
      socket.write(head);
      setTimeout(() => {
        socket.destroy();
        resolve({ first: text.split("\r\n")[0] ?? "", closed, after: Date.now() - started });
      }, waitMs);
    });

  it("closes the connection on every refusal made before a body is read, so a body that never comes holds nothing", async () => {
    const heads = [
      `POST /mcp HTTP/1.1\r\nhost: 127.0.0.1:${served.port}\r\ncontent-length: 1000\r\n\r\npartial`,
      `PUT /files/inbox/x HTTP/1.1\r\nhost: 127.0.0.1:${served.port}\r\ncontent-length: 1000\r\n\r\npartial`,
      `POST /other HTTP/1.1\r\nhost: 127.0.0.1:${served.port}\r\nauthorization: Bearer ${token}\r\ncontent-length: 1000\r\n\r\npartial`,
      `GET /mcp HTTP/1.1\r\nhost: 127.0.0.1:${served.port}\r\nauthorization: Bearer ${token}\r\ncontent-length: 1000\r\n\r\npartial`,
      `POST /mcp HTTP/1.1\r\nhost: evil.example\r\nauthorization: Bearer ${token}\r\ncontent-length: 1000\r\n\r\npartial`,
    ];
    for (const head of heads) {
      const seen = await quiet(head, 300);
      expect(seen.first).toMatch(/^HTTP\/1\.1 (401|404|405|421)/);
      expect(seen.closed).toBe(true);
    }
    const answer = await raw(served, "POST", "/mcp", { body: "{}" });
    expect(answer.status).toBe(401);
    expect(answer.headers["connection"]).toBe("close");
  });

  it("gives a signed-in request one route's worth of time for its body, and then an answer", async () => {
    const seen = await quiet(`POST /mcp HTTP/1.1\r\nhost: 127.0.0.1:${served.port}\r\nauthorization: Bearer ${token}\r\ncontent-type: application/json\r\ncontent-length: 1000\r\n\r\n{"jsonrpc"`, 1500);
    expect(seen.first).toBe("HTTP/1.1 408 Request Timeout");
    expect(seen.closed).toBe(true);
  });

  it("drops an upload that stops sending, and one that takes longer than a call may, and keeps nothing of either", async () => {
    const before = await entries(inbox);
    const stalled = await quiet(`PUT /files/inbox/made/for/stall.bin HTTP/1.1\r\nhost: 127.0.0.1:${served.port}\r\nauthorization: Bearer ${token}\r\ncontent-length: 1000\r\n\r\n0123456789`, 1500);
    expect(stalled.closed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await entries(inbox)).toEqual(before);
    // One that keeps sending, slowly, is cut off at the total limit.
    const result = await new Promise<string>((resolve) => {
      const socket = connect(served.port as number, "127.0.0.1");
      let text = "";
      socket.on("data", (chunk) => (text += chunk.toString()));
      socket.on("close", () => resolve(text.length === 0 ? "closed" : text.split("\r\n")[0] ?? ""));
      socket.on("error", () => undefined);
      socket.write(`PUT /files/inbox/made/for/slow.bin HTTP/1.1\r\nhost: 127.0.0.1:${served.port}\r\nauthorization: Bearer ${token}\r\ncontent-length: 1000\r\n\r\n`);
      const ticker = setInterval(() => socket.write("x"), 200);
      setTimeout(() => {
        clearInterval(ticker);
        socket.destroy();
      }, 3000);
    });
    expect(result).toBe("closed");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await entries(inbox)).toEqual(before);
  });
});

describe("an upload that comes to nothing", () => {
  let served: Served;
  let inbox: string;
  let outside: string;
  const entries = async (dir: string): Promise<string[]> => (await readdir(dir, { recursive: true })).sort();
  const put = (target: string, body: Buffer | string | readonly Buffer[], headers: Record<string, string> = {}): Promise<Answer> => raw(served, "PUT", target, { headers: { ...auth, ...headers }, body });

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-undone-"));
    inbox = join(dir, "in");
    outside = join(dir, "outside");
    await mkdir(join(inbox, "kept"), { recursive: true });
    await mkdir(outside);
    served = (await start("undone", { MCP_HTTP_FILES_INBOX: inbox, MCP_HTTP_FILES_MAX_BYTES: "1024" })).served;
  });
  afterAll(() => served.close());

  it("takes the folders it made with it, and leaves the ones that were there", async () => {
    const before = await entries(inbox);
    expect((await put("/files/inbox/kept/new/deeper/a.txt", "what arrived", { "x-content-sha256": sha256("what was sent") })).status).toBe(422);
    expect((await put("/files/inbox/fresh/b.bin", [Buffer.alloc(700), Buffer.alloc(700)])).status).toBe(413);
    expect((await put("/files/inbox/fresh/c.bin", Buffer.alloc(5000))).status).toBe(413);
    await mkdir(join(inbox, "kept", "isdir"));
    expect((await put("/files/inbox/kept/isdir", "x")).status).toBe(409);
    await new Promise<void>((resolve) => {
      const req = request({ host: "127.0.0.1", port: served.port, method: "PUT", path: "/files/inbox/gone/halfway/d.bin", headers: { ...auth, "content-length": "900" } });
      req.on("error", () => resolve());
      req.write(Buffer.alloc(100));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 50);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await entries(inbox)).toEqual([...before, "kept/isdir"].sort());
  });

  it("keeps the folders an upload that succeeded needed", async () => {
    expect((await put("/files/inbox/made/for/it.txt", "stored")).status).toBe(200);
    expect(await readFile(join(inbox, "made", "for", "it.txt"), "utf8")).toBe("stored");
  });

  it("does not take a folder another upload has put a file in", async () => {
    await put("/files/inbox/shared/first.txt", "first");
    expect((await put("/files/inbox/shared/second.txt", "second", { "x-content-sha256": sha256("other") })).status).toBe(422);
    expect(await readFile(join(inbox, "shared", "first.txt"), "utf8")).toBe("first");
  });
});

describe("storeStream, held to a folder", () => {
  it("refuses a temp file that turns out to be outside the folder it was to be in, and leaves nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-within-"));
    const folder = join(dir, "folder");
    await mkdir(folder);
    const source = async function* (): AsyncGenerator<Buffer> {
      yield Buffer.from("never stored");
    };
    const outside = await storeStream(source(), join(folder, "a.txt"), { maxBytes: 100, within: join(dir, "elsewhere") });
    expect(outside).toEqual({ ok: false, reason: "outside" });
    expect(await readdir(folder)).toEqual([]);
    const inside = await storeStream(source(), join(folder, "a.txt"), { maxBytes: 100, within: await realpath(folder) });
    expect(inside).toMatchObject({ ok: true, size: 12 });
    expect(await readFile(join(folder, "a.txt"), "utf8")).toBe("never stored");
  });
});
