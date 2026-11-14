import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectTo, jsonOf, relayToken, sha256, startWorld, upstreamToken, type World } from "./harness.js";

const entries = async (dir: string): Promise<string[]> => (await readdir(dir, { recursive: true })).sort();
const lines = (log: readonly string[], prefix: string): Record<string, unknown>[] => log.filter((l) => l.startsWith(`${prefix} `)).map((l) => JSON.parse(l.slice(prefix.length + 1)) as Record<string, unknown>);

describe("a relay in front of a server on another disk", () => {
  let world: World;
  beforeAll(async () => {
    world = await startWorld({ serverMaxBytes: 2 * 1024 * 1024 });
  });
  afterAll(() => world.close());

  describe.each(["legacy", "modern"] as const)("for a client of protocol %s", (era) => {
    it("serves the server's tools under its own local address", async () => {
      const client = await connectTo(world, era);
      expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["count_and_save", "echo", "link_to", "read_input", "read_inputs", "save_blob", "save_report"]);
      expect(client.getNegotiatedProtocolVersion()).toBe(era === "modern" ? "2026-07-28" : "2025-11-25");
      await client.close();
    });

    it("puts a file the server saved at its path here before the result is handed on", async () => {
      const client = await connectTo(world, era);
      const name = `report-${era}.txt`;
      const result = (await client.callTool({ name: "save_report", arguments: { name, text: `quarterly figures (${era})` } })) as { content: { type: string; uri?: string }[] };
      // The result has just arrived, and the file it links is already on this disk, byte for byte.
      expect(result.content[1]?.uri).toBe(`file://${world.localOut}/${name}`);
      expect(await readFile(join(world.localOut, name), "utf8")).toBe(`quarterly figures (${era})`);
      expect(jsonOf(result)).toMatchObject({ saved: name, sha256: sha256(`quarterly figures (${era})`) });
      await client.close();
    });

    it("sends a file the arguments name from the inbox to the server, which reads it", async () => {
      const client = await connectTo(world, era);
      const path = join(world.localIn, `scan-${era}.txt`);
      await writeFile(path, `pages of ${era}`);
      const result = await client.callTool({ name: "read_input", arguments: { path } });
      expect(jsonOf(result)).toEqual({ size: `pages of ${era}`.length, sha256: sha256(`pages of ${era}`), text: `pages of ${era}` });
      expect(await readFile(join(world.remoteIn, `scan-${era}.txt`), "utf8")).toBe(`pages of ${era}`);
      await client.close();
    });
  });

  it("brings a file into a folder of the outbox, and creates the folders, with a mode that keeps the world out", async () => {
    const client = await connectTo(world);
    await client.callTool({ name: "save_report", arguments: { name: "q3.csv", text: "id,total\n1,10\n", folder: "2026-09/invoices" } });
    const path = join(world.localOut, "2026-09", "invoices", "q3.csv");
    expect(await readFile(path, "utf8")).toBe("id,total\n1,10\n");
    expect((await stat(path)).mode & 0o007).toBe(0);
    expect((await stat(path)).mode & ~0o640).toBe(0o100000);
    await client.close();
  });

  it("brings a large binary file over intact, and sends one back the other way", async () => {
    const client = await connectTo(world);
    const size = 1536 * 1024 + 11;
    const saved = jsonOf(await client.callTool({ name: "save_blob", arguments: { name: "blob.bin", size } }));
    const here = await readFile(join(world.localOut, "blob.bin"));
    expect(here.length).toBe(size);
    expect(sha256(here)).toBe(saved["sha256"]);
    await writeFile(join(world.localIn, "blob.bin"), here);
    const echoed = jsonOf(await client.callTool({ name: "read_input", arguments: { path: join(world.localIn, "blob.bin") } }));
    expect(echoed).toMatchObject({ size, sha256: saved["sha256"] });
    await client.close();
  });

  it("finds the files in nested arguments, sends each once, and leaves every other string alone", async () => {
    const client = await connectTo(world);
    const [a, b] = ["a.txt", "b.txt"].map((name) => join(world.localIn, name)) as [string, string];
    await writeFile(a, "file a");
    await writeFile(b, "file b");
    const before = world.relayLog.length;
    const result = jsonOf(
      await client.callTool({ name: "read_inputs", arguments: { job: { note: `see ${a}`, paths: [a, b, a, join(world.localIn, "missing.txt"), "/etc/hostname", "b.txt", `${world.localIn}/../outside.txt`] } } }),
    );
    expect(result[a]).toBe("file a");
    expect(result[b]).toBe("file b");
    expect(String(result[join(world.localIn, "missing.txt")])).toMatch(/error/);
    const uploads = lines(world.relayLog.slice(before), "relay-file").filter((l) => l["direction"] === "upload");
    expect(uploads.map((l) => l["path"]).sort()).toEqual([a, b]);
    await client.close();
  });

  it("forwards the arguments exactly as the client wrote them", async () => {
    const client = await connectTo(world);
    const path = join(world.localIn, "echoed.txt");
    await writeFile(path, "echo me");
    const answer = jsonOf(await client.callTool({ name: "echo", arguments: { path, more: [path, "plain"] } }));
    expect(answer).toEqual({ path, more: [path, "plain"] });
    await client.close();
  });

  it.each(["legacy", "modern"] as const)("keeps a stream a stream, and fetches the file in its last event first, for protocol %s", async (era) => {
    const client = await connectTo(world, era);
    const order: string[] = [];
    const name = `streamed-${era}.txt`;
    const result = await client.callTool({ name: "count_and_save", arguments: { name, text: "streamed bytes" } }, {
      onprogress: (progress) => void order.push(`progress ${progress.progress}`),
    });
    order.push("result");
    expect(order).toEqual(["progress 1", "result"]);
    expect((result as { content: { uri?: string }[] }).content[1]?.uri).toBe(`file://${world.localOut}/${name}`);
    expect(await readFile(join(world.localOut, name), "utf8")).toBe("streamed bytes");
    await client.close();
  });

  it("logs one line for each file moved, with its direction, path, size and the start of its hash, and nothing of its content", () => {
    const moved = lines(world.relayLog, "relay-file");
    expect(moved).toContainEqual({ direction: "download", path: join(world.localOut, "report-legacy.txt"), size: "quarterly figures (legacy)".length, sha256: sha256("quarterly figures (legacy)").slice(0, 12) });
    expect(moved).toContainEqual({ direction: "upload", path: join(world.localIn, "scan-legacy.txt"), size: "pages of legacy".length, sha256: sha256("pages of legacy").slice(0, 12) });
    const everything = world.relayLog.join("\n");
    expect(everything).not.toMatch(/quarterly figures|pages of|file a|streamed bytes/);
    expect(everything).not.toContain(upstreamToken);
    expect(everything).not.toContain(relayToken);
  });

  it("says, once for each file, that the server keeps its inbox somewhere else than the call names (here the two are told apart on purpose)", () => {
    const warnings = lines(world.relayLog, "relay-warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatchObject({ message: expect.stringMatching(/MCP_RELAY_INBOX must be the folder the server's tools read/) });
  });

  describe("an inbox file the relay does not send", () => {
    it("is a link to a file outside the inbox", async () => {
      const client = await connectTo(world);
      await writeFile(join(world.dir, "secret.txt"), "not for the server");
      await symlink(join(world.dir, "secret.txt"), join(world.localIn, "linked.txt"));
      const result = jsonOf(await client.callTool({ name: "read_input", arguments: { path: join(world.localIn, "linked.txt") } }));
      expect(String(result["error"])).toMatch(/does not exist|not_found|not inside/);
      expect(await entries(world.remoteIn)).not.toContain("linked.txt");
      await client.close();
    });

    it("is reached through a link to a folder outside the inbox", async () => {
      const client = await connectTo(world);
      await mkdir(join(world.dir, "elsewhere"), { recursive: true });
      await writeFile(join(world.dir, "elsewhere", "doc.txt"), "elsewhere");
      await symlink(join(world.dir, "elsewhere"), join(world.localIn, "folder-link"));
      await client.callTool({ name: "read_input", arguments: { path: join(world.localIn, "folder-link", "doc.txt") } });
      expect(await entries(world.remoteIn)).not.toContain("folder-link");
      expect(await entries(world.remoteIn)).not.toContain(join("folder-link", "doc.txt"));
      await client.close();
    });

    it("climbs out of the inbox with ..", async () => {
      const client = await connectTo(world);
      await writeFile(join(world.dir, "local", "outside.txt"), "outside the inbox");
      await client.callTool({ name: "read_input", arguments: { path: `${world.localIn}/../outside.txt` } });
      expect(await entries(world.remoteIn)).not.toContain("outside.txt");
      await client.close();
    });

    it("is the inbox itself, or a folder", async () => {
      const client = await connectTo(world);
      await mkdir(join(world.localIn, "a-folder"), { recursive: true });
      const before = world.relayLog.length;
      await client.callTool({ name: "read_input", arguments: { path: world.localIn } });
      await client.callTool({ name: "read_input", arguments: { path: join(world.localIn, "a-folder") } });
      expect(lines(world.relayLog.slice(before), "relay-file")).toEqual([]);
      await client.close();
    });
  });

  describe("an outbox link the relay does not follow, or cannot", () => {
    it("leaves alone a link to anywhere but this machine's outbox", async () => {
      const client = await connectTo(world);
      const before = world.relayLog.length;
      const uris = ["https://example.com/report.pdf", "file:///etc/hostname", `file://${world.localOut}/../escaped.txt`, `file://${world.localOut}%2Fescaped.txt`, "file://other.example/out/x.txt", "not a uri"];
      const result = (await client.callTool({ name: "link_to", arguments: { uris } })) as { content: { type: string; uri?: string; text?: string }[] };
      expect(result.content.map((item) => item.uri ?? item.text)).toEqual(["links", ...uris]);
      expect(lines(world.relayLog.slice(before), "relay-file")).toEqual([]);
      await client.close();
    });

    it("hands the result on with a line that says which file is missing and why, when the server has none at that path", async () => {
      const client = await connectTo(world);
      const ghost = join(world.localOut, "ghost.txt");
      const result = (await client.callTool({ name: "link_to", arguments: { uris: [`file://${ghost}`] } })) as { isError?: boolean; content: { type: string; uri?: string; text?: string }[] };
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(3);
      expect(result.content[1]?.uri).toBe(`file://${ghost}`);
      expect(result.content[2]?.type).toBe("text");
      expect(result.content[2]?.text).toContain(ghost);
      expect(result.content[2]?.text).toMatch(/404/);
      expect(await entries(world.localOut)).not.toContain("ghost.txt");
      await client.close();
    });

    it("does not write through a link in the outbox that leads out of it", async () => {
      const client = await connectTo(world);
      const outside = join(world.dir, "outside-out");
      await mkdir(outside, { recursive: true });
      await symlink(outside, join(world.localOut, "escape"));
      await mkdir(join(world.remoteOut, "escape"), { recursive: true });
      await writeFile(join(world.remoteOut, "escape", "x.txt"), "would land outside");
      const result = (await client.callTool({ name: "link_to", arguments: { uris: [`file://${world.localOut}/escape/x.txt`] } })) as { content: { text?: string }[] };
      expect(result.content.at(-1)?.text).toMatch(/leads out of MCP_RELAY_OUTBOX/);
      expect(await entries(outside)).toEqual([]);
      await client.close();
    });

    it("fetches a file that exists on the server but was not made by the call, for a link that names it", async () => {
      const client = await connectTo(world);
      await writeFile(join(world.remoteOut, "preexisting.txt"), "was there");
      await client.callTool({ name: "link_to", arguments: { uris: [`file://${world.localOut}/preexisting.txt`] } });
      expect(await readFile(join(world.localOut, "preexisting.txt"), "utf8")).toBe("was there");
      await client.close();
    });
  });

  describe("a file the server will not take", () => {
    it("fails the call with an error that names the file and why, and the call is not made", async () => {
      const client = await connectTo(world);
      const big = join(world.localIn, "too-big.bin");
      await writeFile(big, Buffer.alloc(3 * 1024 * 1024, 7));
      const before = world.upstreamAudit.length;
      const failure = await client.callTool({ name: "read_input", arguments: { path: big } }).then(
        () => undefined,
        (error: unknown) => error as { message: string; code?: number },
      );
      expect(failure?.message).toContain(big);
      expect(failure?.message).toMatch(/too large \(413\)/);
      expect(failure?.message).not.toContain(upstreamToken);
      expect(world.upstreamAudit.slice(before).filter((line) => line.startsWith("audit "))).toEqual([]);
      expect(await entries(world.remoteIn)).not.toContain("too-big.bin");
      await client.close();
    });
  });

  describe("batches", () => {
    const post = (body: unknown): Promise<Response> =>
      fetch(world.relayUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${relayToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
      });
    const call = (id: number, path: string) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "read_input", arguments: { path } } });

    it("answers every call whose file could not be sent with its own error, when none can go", async () => {
      const big = join(world.localIn, "too-big-too.bin");
      await writeFile(big, Buffer.alloc(3 * 1024 * 1024, 9));
      const single = await (await post(call(7, big))).json();
      expect(single).toMatchObject({ jsonrpc: "2.0", id: 7, error: { code: -32000, message: expect.stringContaining(big) } });
      const batch = (await (await post([call(1, big), call(2, big)])).json()) as { id: number; error?: unknown }[];
      expect(batch.map((m) => m.id)).toEqual([1, 2]);
      expect(batch.every((m) => m.error !== undefined)).toBe(true);
    });
  });
});

describe("a relay with only one folder", () => {
  it("carries no file the other way", async () => {
    const world = await startWorld({ relayEnv: { MCP_RELAY_OUTBOX: "" } });
    try {
      const client = await connectTo(world);
      await client.callTool({ name: "save_report", arguments: { name: "kept-remote.txt", text: "stays" } });
      expect(await entries(world.localOut)).toEqual([]);
      const path = join(world.localIn, "x.txt");
      await writeFile(path, "still goes up");
      expect(jsonOf(await client.callTool({ name: "read_input", arguments: { path } }))).toMatchObject({ text: "still goes up" });
      await client.close();
    } finally {
      await world.close();
    }
  });

  it("sends no file up when it has no inbox", async () => {
    const world = await startWorld({ relayEnv: { MCP_RELAY_INBOX: "" } });
    try {
      const client = await connectTo(world);
      const path = join(world.localIn, "x.txt");
      await writeFile(path, "stays here");
      const result = jsonOf(await client.callTool({ name: "read_input", arguments: { path } }));
      expect(String(result["error"])).toBeTruthy();
      expect(await entries(world.remoteIn)).toEqual([]);
      await client.close();
    } finally {
      await world.close();
    }
  });
});

describe("a relay that presents the wrong token to the server", () => {
  const wrong = "wrong-token-0123456789abcdef";
  const post = (url: string, body: unknown): Promise<Response> =>
    fetch(url, { method: "POST", headers: { authorization: `Bearer ${relayToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });

  it("fails a call, and a file it would have sent, in words that name the token's file and not the token", async () => {
    const world = await startWorld({ presentedToken: wrong });
    try {
      const call = await post(world.relayUrl, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(call.status).toBe(502);
      const said = await call.text();
      expect(said).toContain("the upstream refused the relay's token (401)");
      expect(said).toContain("MCP_RELAY_UPSTREAM_TOKEN_FILE");
      expect(said).not.toContain(wrong);

      const path = join(world.localIn, "needs-token.txt");
      await writeFile(path, "never sent");
      const withFile = (await (await post(world.relayUrl, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_input", arguments: { path } } })).json()) as { error: { message: string } };
      expect(withFile.error.message).toContain(path);
      expect(withFile.error.message).toContain("refused the relay's token (401)");
      expect(JSON.stringify(withFile)).not.toContain(wrong);
      expect(await entries(world.remoteIn)).toEqual([]);
      expect(world.relayLog.join("\n")).not.toContain(wrong);
    } finally {
      await world.close();
    }
  });

  it("does not hand a client the server's token as its own", async () => {
    const world = await startWorld();
    try {
      const answer = await fetch(world.relayUrl, { method: "POST", headers: { authorization: `Bearer ${upstreamToken}`, "content-type": "application/json" }, body: "{}" });
      expect(answer.status).toBe(401);
    } finally {
      await world.close();
    }
  });
});
