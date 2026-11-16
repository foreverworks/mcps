import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readdir, readFile, realpath, rename, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { guardSettingsFrom, hasClientCeiling } from "../src/serve/confirm.js";
import {
  DEFAULT_FILES_MAX_BYTES,
  DEFAULT_HELD_FILES_MAX_AGE_MIN,
  type FileEndpoints,
  fileRouteOf,
  FILES_REFUSED_FOR_CEILING,
  filesFrom,
  filesUrlPath,
  heldMaxAgeMinOf,
  segmentsOf,
} from "../src/serve/files.js";
import { makeHandled } from "../src/envelope.js";
import { storeStream } from "../src/fileStream.js";
import { saveToOutbox } from "../src/handedBack.js";
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

  it("keeps files for ever while MCP_HTTP_FILES_MAX_AGE_MIN is unset or blank: the key is not there", () => {
    expect(filesFrom({ MCP_HTTP_FILES_INBOX: "/srv/in", MCP_HTTP_FILES_MAX_AGE_MIN: "  " })).toEqual({ inbox: "/srv/in", maxBytes: DEFAULT_FILES_MAX_BYTES });
    expect(filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out" })).not.toHaveProperty("maxAgeMin");
  });

  it("reads MCP_HTTP_FILES_MAX_AGE_MIN as a whole number of minutes, for either folder or both", () => {
    expect(filesFrom({ MCP_HTTP_FILES_INBOX: "/srv/in", MCP_HTTP_FILES_MAX_AGE_MIN: " 90 " })).toEqual({ inbox: "/srv/in", maxBytes: DEFAULT_FILES_MAX_BYTES, maxAgeMin: 90 });
    expect(filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out", MCP_HTTP_FILES_MAX_AGE_MIN: "1" })).toEqual({ outbox: "/srv/out", maxBytes: DEFAULT_FILES_MAX_BYTES, maxAgeMin: 1 });
    expect(filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out", MCP_HTTP_FILES_INBOX: "/srv/in", MCP_HTTP_FILES_MAX_AGE_MIN: "1440" })).toMatchObject({ maxAgeMin: 1440 });
  });

  it("refuses an age that is not a whole number of minutes above zero, and an age with no folder to clear", () => {
    for (const bad of ["0", "-5", "1.5", "1e3", "+5", "0x10", "an hour", "30m", "99999999999999999999"]) {
      expect(() => filesFrom({ MCP_HTTP_FILES_INBOX: "/srv/in", MCP_HTTP_FILES_MAX_AGE_MIN: bad })).toThrow(/MCP_HTTP_FILES_MAX_AGE_MIN ".*" is not a number of minutes/);
    }
    expect(() => filesFrom({ MCP_HTTP_FILES_MAX_AGE_MIN: "60" })).toThrow(/MCP_HTTP_FILES_MAX_AGE_MIN is set without MCP_HTTP_FILES_INBOX or MCP_HTTP_FILES_OUTBOX/);
  });

  it("reads how long a held client may fetch its own files: the setting, else the outbox's age, else a day", () => {
    expect(filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out", MCP_HTTP_FILES_HELD_MAX_AGE_MIN: " 43200 " })).toEqual({ outbox: "/srv/out", maxBytes: DEFAULT_FILES_MAX_BYTES, heldMaxAgeMin: 43200 });
    expect(filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out", MCP_HTTP_FILES_HELD_MAX_AGE_MIN: " " })).not.toHaveProperty("heldMaxAgeMin");
    const of = (env: Record<string, string>): number => heldMaxAgeMinOf(filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out", ...env }) as FileEndpoints);
    expect(of({ MCP_HTTP_FILES_HELD_MAX_AGE_MIN: "43200", MCP_HTTP_FILES_MAX_AGE_MIN: "60" })).toBe(43200);
    expect(of({ MCP_HTTP_FILES_MAX_AGE_MIN: "60" })).toBe(60);
    expect(of({})).toBe(24 * 60);
    expect(DEFAULT_HELD_FILES_MAX_AGE_MIN).toBe(24 * 60);
  });

  it("refuses a held client's age that is not a whole number of minutes above zero, and one with no outbox", () => {
    for (const bad of ["0", "-5", "1.5", "a day", "30m"]) {
      expect(() => filesFrom({ MCP_HTTP_FILES_OUTBOX: "/srv/out", MCP_HTTP_FILES_HELD_MAX_AGE_MIN: bad })).toThrow(/MCP_HTTP_FILES_HELD_MAX_AGE_MIN ".*" is not a number of minutes/);
    }
    expect(() => filesFrom({ MCP_HTTP_FILES_INBOX: "/srv/in", MCP_HTTP_FILES_HELD_MAX_AGE_MIN: "60" })).toThrow(/MCP_HTTP_FILES_HELD_MAX_AGE_MIN is set without MCP_HTTP_FILES_OUTBOX/);
    expect(() => filesFrom({ MCP_HTTP_FILES_HELD_MAX_AGE_MIN: "60" })).toThrow(/without MCP_HTTP_FILES_OUTBOX/);
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
    for (const name of ["MCP_HTTP_FILES_OUTBOX", "MCP_HTTP_FILES_INBOX", "MCP_HTTP_FILES_MAX_BYTES", "MCP_HTTP_FILES_MAX_AGE_MIN", "MCP_HTTP_FILES_HELD_MAX_AGE_MIN"]) {
      expect(() => listenFrom({ [name]: "/srv/x" })).toThrow(new RegExp(`${name} is set without MCP_HTTP_PORT`));
      expect(listenFrom({ [name]: " " })).toEqual({ kind: "stdio" });
    }
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_HTTP_FILES_OUTBOX: "/srv/out" })).toThrow(
      /MCP_HTTP_PUBLIC_HOSTS and MCP_HTTP_FILES_OUTBOX are both set/,
    );
    expect(() => listenFrom({ MCP_HTTP_PORT: "3000", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_HTTP_FILES_MAX_AGE_MIN: "60" })).toThrow(
      /MCP_HTTP_PUBLIC_HOSTS and MCP_HTTP_FILES_MAX_AGE_MIN are both set/,
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

describe("a client held to a ceiling (MCP_CLIENT_MAX_ACCESS), and the file endpoints", () => {
  const log: string[] = [];
  let served: Served;
  let inbox: string;
  let outbox: string;
  const secretName = "board-minutes-2026.pdf";
  const secretBytes = "CONFIDENTIAL minutes of another client's call";
  const bearer = (client: string): { authorization: string } => ({ authorization: `Bearer ${client}-token-0123456789abcdef` });
  const entries = async (dir: string): Promise<string[]> => (await readdir(dir, { recursive: true })).sort();

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-ceiling-files-"));
    inbox = join(dir, "in");
    outbox = join(dir, "out");
    const tokens = join(dir, "tokens");
    await mkdir(inbox);
    await mkdir(join(outbox, "reports"), { recursive: true });
    await mkdir(tokens);
    await writeFile(join(outbox, secretName), secretBytes);
    await writeFile(join(outbox, "reports", "q3.csv"), "id,amount\n1,10\n");
    for (const client of ["reader", "writer", "payer", "open", "constructor"]) await writeFile(join(tokens, `token-${client}`), `${client}-token-0123456789abcdef\n`);
    served = await serve({
      name: "ceilinged",
      version: "0.0.0",
      register: ping,
      policy: { ping: { access: "read" } },
      env: {
        MCP_HTTP_PORT: "0",
        MCP_HTTP_TOKENS_DIR: tokens,
        MCP_HTTP_FILES_OUTBOX: outbox,
        MCP_HTTP_FILES_INBOX: inbox,
        MCP_HTTP_FILES_MAX_BYTES: String(2 * 1024 * 1024),
        MCP_CLIENT_MAX_ACCESS: "reader=read,writer=write,payer=money",
      },
      log: (line) => log.push(line),
    });
  });
  afterAll(() => served.close());

  const held = ["reader", "writer", "payer"] as const;
  const asked: readonly (readonly [string, string, string])[] = [
    ["downloads a file that is there", "GET", `/files/outbox/${secretName}`],
    ["downloads a file in a folder", "GET", "/files/outbox/reports/q3.csv"],
    ["downloads a file that is not there", "GET", "/files/outbox/missing.pdf"],
    ["asks for the outbox folder itself", "GET", "/files/outbox/"],
    ["asks for a path out of the folder", "GET", "/files/outbox/../secret"],
    ["uploads a file", "PUT", "/files/inbox/scan.pdf"],
    ["uploads into a folder", "PUT", "/files/inbox/2026-09/scan.pdf"],
    ["uploads to a bad path", "PUT", "/files/inbox/%2e%2e/scan.pdf"],
    ["uses the wrong method on an upload", "GET", "/files/inbox/scan.pdf"],
    ["uses the wrong method on a download", "PUT", `/files/outbox/${secretName}`],
    ["deletes", "DELETE", `/files/outbox/${secretName}`],
  ];
  const cases = held.flatMap((client) => asked.map(([what, method, target]) => [client, what, method, target] as const));

  it.each(cases)("refuses %s, which %s, with a 403 that says why", async (client, _what, method, target) => {
    const answer = await raw(served, method, target, { headers: bearer(client), ...(method === "PUT" ? { body: "bytes the client wants stored" } : {}) });
    expect(answer.status).toBe(403);
    expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
    const words = answer.body.toString();
    expect(words).toBe(`${FILES_REFUSED_FOR_CEILING}\n`);
    expect(words).toMatch(/ceiling/);
    expect(words).toMatch(/outside the tool calls/);
    expect(words).toMatch(/clients with no ceiling/);
  });

  it("is the same answer whether the file is there or not, and never has a name or a byte of the folder in it", async () => {
    const answers = await Promise.all(
      ["reader", "writer", "payer"].flatMap((client) => [secretName, "reports/q3.csv", "missing.pdf", "..%2f..%2fetc%2fpasswd"].map((name) => raw(served, "GET", `/files/outbox/${name}`, { headers: bearer(client) }))),
    );
    const bodies = new Set(answers.map((answer) => answer.body.toString()));
    expect(bodies.size).toBe(1);
    const everything = answers.map((answer) => `${JSON.stringify(answer.headers)}${answer.body.toString()}`).join("\n");
    for (const leak of [secretName, "board-minutes", "CONFIDENTIAL", "q3.csv", "reports", "id,amount"]) expect(everything).not.toContain(leak);
    expect(answers.every((answer) => answer.headers["x-content-sha256"] === undefined)).toBe(true);
  });

  it("stores nothing of an upload it refuses, a large one included, and the client still reads the answer", async () => {
    for (const client of held) {
      const big = Buffer.alloc(1024 * 1024, 7);
      const answer = await raw(served, "PUT", `/files/inbox/${client}/big.bin`, { headers: { ...bearer(client), "x-content-sha256": sha256(big) }, body: big });
      expect(answer.status).toBe(403);
      expect(answer.body.toString()).toBe(`${FILES_REFUSED_FOR_CEILING}\n`);
    }
    expect(await entries(inbox)).toEqual([]);
  });

  it("serves the client that has no ceiling as it always did, in both directions", async () => {
    const down = await raw(served, "GET", `/files/outbox/${secretName}`, { headers: bearer("open") });
    expect(down.status).toBe(200);
    expect(down.body.toString()).toBe(secretBytes);
    expect(down.headers["x-content-sha256"]).toBe(sha256(secretBytes));
    expect((await raw(served, "GET", "/files/outbox/missing.pdf", { headers: bearer("open") })).status).toBe(404);

    const body = Buffer.from("scanned pages");
    const up = await raw(served, "PUT", "/files/inbox/open/scan.pdf", { headers: { ...bearer("open"), "x-content-sha256": sha256(body) }, body });
    expect(up.status).toBe(200);
    expect(JSON.parse(up.body.toString())).toEqual({ path: join(inbox, "open", "scan.pdf"), size: 13, sha256: sha256(body) });
    expect(await readFile(join(inbox, "open", "scan.pdf"), "utf8")).toBe("scanned pages");
  });

  it("holds a client by an entry of its own, so a client whose name is a member of every object has none", async () => {
    const down = await raw(served, "GET", `/files/outbox/${secretName}`, { headers: bearer("constructor") });
    expect(down.status).toBe(200);
    expect(down.body.toString()).toBe(secretBytes);
  });

  it("still answers 401 to a request with no token or a wrong one, and 421 to another Host, before it says anything about ceilings", async () => {
    for (const [method, target] of [["GET", `/files/outbox/${secretName}`], ["PUT", "/files/inbox/anon.txt"]] as const) {
      const none = await raw(served, method, target);
      expect(none.status).toBe(401);
      expect(none.body.toString()).toBe("unauthorized\n");
      const wrong = await raw(served, method, target, { headers: { authorization: "Bearer reader-token-0123456789abcdeX" } });
      expect(wrong.status).toBe(401);
      expect(wrong.body.toString()).toBe("unauthorized\n");
      expect((await raw(served, method, target, { headers: { ...bearer("reader"), host: "evil.example" } })).status).toBe(421);
    }
    expect(await entries(inbox)).not.toContain("anon.txt");
  });

  it("leaves the held client its tool calls, which the ceiling checks", async () => {
    const call = (client: string): Promise<Answer> =>
      raw(served, "POST", MCP_PATH, {
        headers: { ...bearer(client), "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ping", arguments: {} } }),
      });
    for (const client of ["reader", "open"]) expect(JSON.parse((await call(client)).body.toString())).toMatchObject({ result: { content: [{ type: "text", text: "pong" }] } });
  });

  it("logs each refusal with the client and the direction, and nothing of the path or the bytes", () => {
    const lines = log.filter((line) => line.startsWith("files ")).map((line) => JSON.parse(line.slice("files ".length)) as Record<string, unknown>);
    expect(lines).toContainEqual({ svc: "ceilinged", client: "reader", direction: "download", outcome: "refused_ceiling" });
    expect(lines).toContainEqual({ svc: "ceilinged", client: "writer", direction: "upload", outcome: "refused_ceiling" });
    expect(lines.filter((line) => line["outcome"] === "refused_ceiling").every((line) => Object.keys(line).sort().join() === "client,direction,outcome,svc")).toBe(true);
    expect(JSON.stringify(lines.filter((line) => line["outcome"] === "refused_ceiling"))).not.toMatch(/board-minutes|CONFIDENTIAL|q3\.csv|scan\.pdf/);
  });
});

/** A server whose read tools save files to the outbox through the kit's writer, inside the kit's envelope, as a real server's do. */
const handled = makeHandled({ asAppError: () => undefined, remedyFor: () => "" });
const savingTools =
  (outbox: string, elsewhere: string) =>
  (server: McpServer): void => {
    server.registerTool(
      "fetch_document",
      { description: "saves a document to the outbox and links it", inputSchema: { name: z.string(), text: z.string(), folder: z.string().optional() } },
      handled(async ({ name, text, folder }: { name: string; text: string; folder?: string | undefined }) => {
        const saved = await saveToOutbox(join(outbox, folder ?? ""), name, text);
        return { saved: saved.path, sha256: saved.sha256, size: saved.size };
      }),
    );
    server.registerTool(
      "fetch_then_fail",
      { description: "saves a document, then fails", inputSchema: { name: z.string() } },
      handled(async ({ name }: { name: string }) => {
        await saveToOutbox(outbox, name, "half of a document");
        throw new Error("the service went away halfway");
      }),
    );
    server.registerTool(
      "fetch_and_hold",
      { description: "saves a document, then waits at a gate the test opens", inputSchema: { name: z.string(), text: z.string(), gate: z.string() } },
      handled(async ({ name, text, gate }: { name: string; text: string; gate: string }) => {
        const saved = await saveToOutbox(outbox, name, text);
        const held = gateOf(gate);
        held.reached();
        await held.opened;
        return { saved: saved.path, sha256: saved.sha256 };
      }),
    );
    server.registerTool("echo_link", { description: "answers with a link to whatever it is given", inputSchema: { uri: z.string() } }, async ({ uri }: { uri: string }) => ({
      content: [{ type: "text" as const, text: "linked" }, { type: "resource_link" as const, uri, name: "linked" }],
    }));
    server.registerTool(
      "save_elsewhere",
      { description: "saves a document outside the outbox", inputSchema: { name: z.string() } },
      handled(async ({ name }: { name: string }) => (await saveToOutbox(elsewhere, name, "outside the outbox")).path),
    );
  };
const SAVING_POLICY = {
  fetch_document: { access: "read" },
  fetch_then_fail: { access: "read" },
  fetch_and_hold: { access: "read" },
  echo_link: { access: "read" },
  save_elsewhere: { access: "read" },
} as const;

/** A point a tool call waits at: `reached` once the call is there, `opened` once the test lets it go on. */
type Gate = { readonly reached: () => void; readonly whenReached: Promise<void>; readonly open: () => void; readonly opened: Promise<void> };
const gates = new Map<string, Gate>();
const gateOf = (name: string): Gate => {
  const known = gates.get(name);
  if (known !== undefined) return known;
  const flags: { reached?: () => void; open?: () => void } = {};
  const whenReached = new Promise<void>((resolve) => (flags.reached = resolve));
  const opened = new Promise<void>((resolve) => (flags.open = resolve));
  const gate: Gate = { reached: () => flags.reached?.(), whenReached, open: () => flags.open?.(), opened };
  gates.set(name, gate);
  return gate;
};

type Saving = { readonly served: Served; readonly dir: string; readonly outbox: string; readonly inbox: string; readonly elsewhere: string; readonly env: Record<string, string> };

const startSaving = async (env: Record<string, string> = {}, at?: string): Promise<Saving> => {
  const dir = at ?? (await mkdtemp(join(tmpdir(), "mcp-kit-own-files-")));
  const [outbox, inbox, elsewhere, tokens] = ["out", "in", "elsewhere", "tokens"].map((name) => join(dir, name)) as [string, string, string, string];
  for (const folder of [outbox, inbox, elsewhere, tokens]) await mkdir(folder, { recursive: true });
  for (const client of ["reader", "other", "open"]) await writeFile(join(tokens, `token-${client}`), `${client}-token-0123456789abcdef\n`);
  const full = { MCP_HTTP_PORT: "0", MCP_HTTP_TOKENS_DIR: tokens, MCP_HTTP_FILES_OUTBOX: outbox, MCP_HTTP_FILES_INBOX: inbox, MCP_CLIENT_MAX_ACCESS: "reader=read,other=read", ...env };
  const served = await serve({ name: "saving", version: "0.0.0", register: savingTools(outbox, elsewhere), policy: SAVING_POLICY, env: full, log: () => undefined });
  return { served, dir, outbox, inbox, elsewhere, env };
};

const bearerOf = (client: string): { authorization: string } => ({ authorization: `Bearer ${client}-token-0123456789abcdef` });

/** One tool call over HTTP, as a client with this name makes it: the result. */
const callAs = async (served: Served, client: string, name: string, args: Record<string, unknown>): Promise<{ content: { type: string; text?: string; uri?: string }[]; isError?: boolean }> => {
  const answer = await raw(served, "POST", MCP_PATH, {
    headers: { ...bearerOf(client), "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return (JSON.parse(answer.body.toString()) as { result: { content: { type: string; text?: string; uri?: string }[]; isError?: boolean } }).result;
};

const fetched = (served: Served, client: string, path: string): Promise<Answer> => raw(served, "GET", `/files/outbox/${path}`, { headers: bearerOf(client) });

const refusedAsHeld = (answer: Answer): void => {
  expect(answer.status).toBe(403);
  expect(answer.body.toString()).toBe(`${FILES_REFUSED_FOR_CEILING}\n`);
  expect(answer.headers["x-content-sha256"]).toBeUndefined();
};

describe("a client held to a ceiling, and the files its own calls handed back", () => {
  let world: Saving;
  beforeAll(async () => {
    world = await startSaving();
  });
  afterAll(() => world.served.close());

  it("fetches the file its own call linked: 200, the bytes, and the SHA-256 the call reported", async () => {
    const text = "%PDF-1.7 statement of account";
    const result = await callAs(world.served, "reader", "fetch_document", { name: "statement.pdf", text });
    const reported = JSON.parse(result.content[0]?.text as string) as { saved: string; sha256: string; size: number };
    expect(result.content[1]).toMatchObject({ type: "resource_link", uri: `file://${join(world.outbox, "statement.pdf")}` });
    for (let round = 0; round < 2; round += 1) {
      const answer = await fetched(world.served, "reader", "statement.pdf");
      expect(answer.status).toBe(200);
      expect(answer.body.toString()).toBe(text);
      expect(answer.headers["x-content-sha256"]).toBe(reported.sha256);
      expect(reported.sha256).toBe(sha256(text));
      expect(answer.headers["content-type"]).toBe("application/pdf");
    }

    await callAs(world.served, "reader", "fetch_document", { name: "q3 #1.csv", text: "id,amount\n1,10\n", folder: "2026-09/reports" });
    const nested = await fetched(world.served, "reader", filesUrlPath("/files/outbox", "2026-09/reports/q3 #1.csv").slice("/files/outbox/".length));
    expect(nested.status).toBe(200);
    expect(nested.body.toString()).toBe("id,amount\n1,10\n");
  });

  it("is refused every file another client's call handed back, held or not, and so is the other held client its own", async () => {
    await callAs(world.served, "reader", "fetch_document", { name: "reader-only.pdf", text: "for reader" });
    await callAs(world.served, "other", "fetch_document", { name: "other-only.pdf", text: "for other" });
    await callAs(world.served, "open", "fetch_document", { name: "open-only.pdf", text: "for open" });
    refusedAsHeld(await fetched(world.served, "reader", "other-only.pdf"));
    refusedAsHeld(await fetched(world.served, "reader", "open-only.pdf"));
    refusedAsHeld(await fetched(world.served, "other", "reader-only.pdf"));
    expect((await fetched(world.served, "other", "other-only.pdf")).body.toString()).toBe("for other");
  });

  it("is refused a guessed path, a folder and a path out of the outbox, with the same 403 whether anything is there or not", async () => {
    await writeFile(join(world.outbox, "planted.txt"), "put here by something else");
    await callAs(world.served, "reader", "save_elsewhere", { name: "outside.txt" });
    for (const path of ["planted.txt", "missing.pdf", "", "2026-09", "2026-09/reports", "..%2felsewhere%2foutside.txt", "../elsewhere/outside.txt", "%2e%2e/elsewhere/outside.txt", "reports//q3.csv"]) {
      refusedAsHeld(await fetched(world.served, "reader", path));
    }
    refusedAsHeld(await raw(world.served, "GET", "/files/outbox", { headers: bearerOf("reader") }));
  });

  it("is refused a link to its own file, a link put where its file was, a file written later at its path, and its file once deleted", async () => {
    await callAs(world.served, "reader", "fetch_document", { name: "mine.txt", text: "mine" });
    await symlink(join(world.outbox, "mine.txt"), join(world.outbox, "alias.txt"));
    refusedAsHeld(await fetched(world.served, "reader", "alias.txt"));

    await callAs(world.served, "reader", "fetch_document", { name: "swap.txt", text: "mine too" });
    await callAs(world.served, "open", "fetch_document", { name: "theirs.txt", text: "theirs" });
    await unlink(join(world.outbox, "swap.txt"));
    await symlink(join(world.outbox, "theirs.txt"), join(world.outbox, "swap.txt"));
    refusedAsHeld(await fetched(world.served, "reader", "swap.txt"));

    await callAs(world.served, "reader", "fetch_document", { name: "same-name.txt", text: "reader's version" });
    expect((await fetched(world.served, "reader", "same-name.txt")).status).toBe(200);
    await callAs(world.served, "open", "fetch_document", { name: "same-name.txt", text: "open's version!" });
    refusedAsHeld(await fetched(world.served, "reader", "same-name.txt"));
    expect((await fetched(world.served, "open", "same-name.txt")).body.toString()).toBe("open's version!");

    await callAs(world.served, "reader", "fetch_document", { name: "gone.txt", text: "soon gone" });
    await unlink(join(world.outbox, "gone.txt"));
    refusedAsHeld(await fetched(world.served, "reader", "gone.txt"));
  });

  it("is refused every upload and every other method, on its own paths too, and nothing is stored", async () => {
    await callAs(world.served, "reader", "fetch_document", { name: "kept.pdf", text: "kept" });
    for (const [method, target] of [
      ["PUT", "/files/inbox/scan.pdf"],
      ["PUT", "/files/inbox/kept.pdf"],
      ["PUT", "/files/outbox/kept.pdf"],
      ["DELETE", "/files/outbox/kept.pdf"],
      ["POST", "/files/outbox/kept.pdf"],
      ["GET", "/files/inbox/kept.pdf"],
    ] as const) {
      refusedAsHeld(await raw(world.served, method, target, { headers: bearerOf("reader"), ...(method === "GET" ? {} : { body: "bytes the client wants stored" }) }));
    }
    expect(await readdir(world.inbox)).toEqual([]);
    expect(await readFile(join(world.outbox, "kept.pdf"), "utf8")).toBe("kept");
  });

  it("gets nothing for a call that failed, though it saved a file before failing", async () => {
    const result = await callAs(world.served, "reader", "fetch_then_fail", { name: "half.txt" });
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(await readFile(join(world.outbox, "half.txt"), "utf8")).toBe("half of a document");
    refusedAsHeld(await fetched(world.served, "reader", "half.txt"));
  });

  it("leaves the client with no ceiling as it was: any file, a 404 for a missing one, and uploads", async () => {
    for (const name of ["statement.pdf", "reader-only.pdf", "planted.txt", "alias.txt"]) expect((await fetched(world.served, "open", name)).status).toBe(200);
    expect((await fetched(world.served, "open", "missing.pdf")).status).toBe(404);
    expect((await fetched(world.served, "open", "../elsewhere/outside.txt")).status).toBe(404);
    const body = Buffer.from("scanned pages");
    const up = await raw(world.served, "PUT", "/files/inbox/open/scan.pdf", { headers: { ...bearerOf("open"), "x-content-sha256": sha256(body) }, body });
    expect(up.status).toBe(200);
  });

  it("keeps two held clients' calls apart while both are in flight at once: each gets its own file, and not the other's", async () => {
    const calls = Promise.all([
      callAs(world.served, "reader", "fetch_and_hold", { name: "reader-at-once.txt", text: "reader, at once", gate: "both-reader" }),
      callAs(world.served, "other", "fetch_and_hold", { name: "other-at-once.txt", text: "other, at once", gate: "both-other" }),
    ]);
    // Both calls have saved their file and neither has answered.
    await Promise.all([gateOf("both-reader").whenReached, gateOf("both-other").whenReached]);
    gateOf("both-reader").open();
    gateOf("both-other").open();
    await calls;
    expect((await fetched(world.served, "reader", "reader-at-once.txt")).body.toString()).toBe("reader, at once");
    expect((await fetched(world.served, "other", "other-at-once.txt")).body.toString()).toBe("other, at once");
    refusedAsHeld(await fetched(world.served, "reader", "other-at-once.txt"));
    refusedAsHeld(await fetched(world.served, "other", "reader-at-once.txt"));
  });

  it("is refused a file another client puts at the same path while its own call is still running, even of the same size", async () => {
    const call = callAs(world.served, "reader", "fetch_and_hold", { name: "x.txt", text: "mine", gate: "overwrite" });
    await gateOf("overwrite").whenReached;
    await callAs(world.served, "open", "fetch_document", { name: "x.txt", text: "THEM" });
    gateOf("overwrite").open();
    const result = await call;
    expect(result.content[1]).toMatchObject({ type: "resource_link" });
    refusedAsHeld(await fetched(world.served, "reader", "x.txt"));
    expect((await fetched(world.served, "open", "x.txt")).body.toString()).toBe("THEM");
  });

  it("is refused a file a tool merely links, its own result's link included", async () => {
    await callAs(world.served, "open", "fetch_document", { name: "echoed.pdf", text: "open's document" });
    const result = await callAs(world.served, "reader", "echo_link", { uri: `file://${join(world.outbox, "echoed.pdf")}` });
    expect(result.content[1]).toMatchObject({ type: "resource_link", uri: `file://${join(world.outbox, "echoed.pdf")}` });
    refusedAsHeld(await fetched(world.served, "reader", "echoed.pdf"));
  });

  it("is refused its file through a linked folder, and a folder on its path swapped for a link to another", async () => {
    await callAs(world.served, "reader", "fetch_document", { name: "f.txt", text: "in real", folder: "tree/real" });
    await symlink(join(world.outbox, "tree", "real"), join(world.outbox, "tree", "alias"));
    refusedAsHeld(await fetched(world.served, "reader", "tree/alias/f.txt"));
    expect((await fetched(world.served, "reader", "tree/real/f.txt")).status).toBe(200);

    await callAs(world.served, "open", "fetch_document", { name: "f.txt", text: "in fake", folder: "tree/fake" });
    await rename(join(world.outbox, "tree", "real"), join(world.outbox, "tree", "was-real"));
    await symlink(join(world.outbox, "tree", "fake"), join(world.outbox, "tree", "real"));
    refusedAsHeld(await fetched(world.served, "reader", "tree/real/f.txt"));
  });

  it("is refused a hard link put at its path, and its own file once a hard link to it is made, which fails closed", async () => {
    await callAs(world.served, "reader", "fetch_document", { name: "linked.txt", text: "my bytes" });
    await callAs(world.served, "open", "fetch_document", { name: "theirs-linked.txt", text: "their bytes" });
    await unlink(join(world.outbox, "linked.txt"));
    await link(join(world.outbox, "theirs-linked.txt"), join(world.outbox, "linked.txt"));
    refusedAsHeld(await fetched(world.served, "reader", "linked.txt"));

    await callAs(world.served, "reader", "fetch_document", { name: "pinned.txt", text: "pinned" });
    expect((await fetched(world.served, "reader", "pinned.txt")).status).toBe(200);
    // The kernel keeps a file's times at its coarse clock (a few ms): wait past one tick, so the link moves the change time for sure.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await link(join(world.outbox, "pinned.txt"), join(world.outbox, "pinned-copy.txt"));
    refusedAsHeld(await fetched(world.served, "reader", "pinned.txt"));
    refusedAsHeld(await fetched(world.served, "reader", "pinned-copy.txt"));
  });

  it("forgets every record when the server restarts: the same fetch is refused until the tool is called again", async () => {
    await world.served.close();
    world = await startSaving({}, world.dir);
    refusedAsHeld(await fetched(world.served, "reader", "statement.pdf"));
    await callAs(world.served, "reader", "fetch_document", { name: "statement.pdf", text: "%PDF-1.7 statement of account" });
    expect((await fetched(world.served, "reader", "statement.pdf")).status).toBe(200);
  });
});

describe("how long a held client's record of its own files is kept", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const fetchAfter = async (world: Saving, minutes: readonly number[]): Promise<number[]> => {
    const started = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(started);
    await callAs(world.served, "reader", "fetch_document", { name: "aged.txt", text: "aged" });
    const statuses: number[] = [];
    for (const minute of minutes) {
      vi.setSystemTime(started + minute * 60_000);
      statuses.push((await fetched(world.served, "reader", "aged.txt")).status);
    }
    return statuses;
  };

  it("as long as the outbox keeps its files, with MCP_HTTP_FILES_MAX_AGE_MIN", async () => {
    const world = await startSaving({ MCP_HTTP_FILES_MAX_AGE_MIN: "30" });
    try {
      expect(await fetchAfter(world, [0, 29, 31])).toEqual([200, 200, 403]);
    } finally {
      await world.served.close();
    }
  });

  it("for MCP_HTTP_FILES_HELD_MAX_AGE_MIN when set, longer than the outbox's own age or shorter", async () => {
    for (const [env, minutes, expected] of [
      [{ MCP_HTTP_FILES_HELD_MAX_AGE_MIN: "120" }, [119, 121], [200, 403]],
      [{ MCP_HTTP_FILES_HELD_MAX_AGE_MIN: "10", MCP_HTTP_FILES_MAX_AGE_MIN: "30" }, [9, 11], [200, 403]],
    ] as const) {
      const world = await startSaving(env);
      try {
        expect(await fetchAfter(world, minutes)).toEqual(expected);
      } finally {
        vi.useRealTimers();
        await world.served.close();
      }
    }
  });

  it("for a day where the outbox keeps its files for ever", async () => {
    const world = await startSaving();
    try {
      expect(await fetchAfter(world, [23 * 60, 24 * 60 + 1])).toEqual([200, 403]);
    } finally {
      await world.served.close();
    }
  });
});

describe("hasClientCeiling", () => {
  it("is true for a client named in MCP_CLIENT_MAX_ACCESS, at any level, and false for every other", () => {
    const settings = guardSettingsFrom({ MCP_CLIENT_MAX_ACCESS: "a=read, b=write,c=money" });
    expect(["a", "b", "c", "d", ""].map((client) => hasClientCeiling(settings, client))).toEqual([true, true, true, false, false]);
  });

  it("is false for all while none is set, and does not take a name that objects have for a client's", () => {
    expect(hasClientCeiling(guardSettingsFrom({}), "a")).toBe(false);
    const settings = guardSettingsFrom({ MCP_CLIENT_MAX_ACCESS: "a=read" });
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(hasClientCeiling(settings, name)).toBe(false);
  });

  it("is not changed by the server-wide ceiling, which the guard checks on its own", () => {
    expect(hasClientCeiling(guardSettingsFrom({ MCP_MAX_ACCESS: "read" }), "a")).toBe(false);
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

describe("retention of the folders (MCP_HTTP_FILES_MAX_AGE_MIN)", () => {
  const old = async (path: string, minutes: number): Promise<void> => {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "in transit");
    const when = new Date(Date.now() - minutes * 60_000);
    await utimes(path, when, when);
  };

  it("deletes old files from both folders as the server starts, keeps the fresh ones, and goes on serving", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-retention-"));
    const inbox = join(dir, "in");
    const outbox = join(dir, "out");
    await old(join(inbox, "2026-01", "scan.pdf"), 600);
    await old(join(inbox, "recent.pdf"), 5);
    await old(join(outbox, "report.csv"), 600);
    await old(join(outbox, "today.csv"), 1);
    const log: string[] = [];
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => void lines.push(args.join(" "));
    let served: Served | undefined;
    try {
      served = (await start("retention", { MCP_HTTP_FILES_INBOX: inbox, MCP_HTTP_FILES_OUTBOX: outbox, MCP_HTTP_FILES_MAX_AGE_MIN: "60" }, log)).served;
    } finally {
      console.error = original;
    }
    try {
      expect(lines.join("\n")).toContain("; files older than 60 min are deleted;");
      await vi.waitFor(async () => {
        expect(await readdir(inbox)).toEqual(["recent.pdf"]);
        expect(await readdir(outbox)).toEqual(["today.csv"]);
      });
      expect(log[0]).toBe(`files ${JSON.stringify({ svc: "retention", direction: "sweep", outcome: "ok", removed: 2, folders: 1 })}`);

      const stored = await raw(served, "PUT", "/files/inbox/new.txt", { headers: auth, body: "fresh upload" });
      expect(stored.status).toBe(200);
      expect((await raw(served, "GET", "/files/outbox/today.csv", { headers: auth })).status).toBe(200);
      expect((await raw(served, "GET", "/files/outbox/report.csv", { headers: auth })).status).toBe(404);
    } finally {
      await served.close();
    }
  });

  it("changes nothing while it is unset: an old file stays, and no line says otherwise", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-retention-"));
    const inbox = join(dir, "in");
    await old(join(inbox, "scan.pdf"), 1e6);
    const log: string[] = [];
    const { served } = await start("kept", { MCP_HTTP_FILES_INBOX: inbox }, log);
    try {
      expect((await raw(served, "PUT", "/files/inbox/another.txt", { headers: auth, body: "x" })).status).toBe(200);
      expect(await readdir(inbox)).toEqual(["another.txt", "scan.pdf"]);
      expect(log.filter((line) => line.includes("sweep"))).toEqual([]);
    } finally {
      await served.close();
    }
  });

  it("refuses to start on an age that is not a number of minutes", async () => {
    await expect(start("bad", { MCP_HTTP_FILES_INBOX: "/srv/in", MCP_HTTP_FILES_MAX_AGE_MIN: "soon" })).rejects.toThrow(/MCP_HTTP_FILES_MAX_AGE_MIN "soon" is not a number of minutes/);
  });
});
