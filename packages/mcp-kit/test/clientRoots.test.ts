import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import type { Transport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { pathsOfRoots, shareClientRoots, shareRootsOf } from "../src/clientRoots.js";
import { clientRootsApply } from "../src/inputFile/roots.js";
import { inputFilesFrom } from "../src/inputFile.js";

describe("pathsOfRoots", () => {
  it("keeps the local folders, decoded, and nothing else", () => {
    expect(pathsOfRoots(["file:///home/me/my%20project", "https://example.com/x", "file:///srv/a"])).toEqual(["/home/me/my project", "/srv/a"]);
  });
});

describe("clientRootsApply", () => {
  it("is stdio with no roots configured", () => {
    expect(clientRootsApply({})).toBe(true);
    expect(clientRootsApply({ MCP_FILE_ROOTS: "/in" })).toBe(false);
    expect(clientRootsApply({ MCP_HTTP_PORT: "3000" })).toBe(false);
  });
});

describe("a stdio client's roots", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    shareClientRoots(undefined);
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  /** A server whose one tool reads a file the way every server does, and a client that may share roots. */
  const connect = async (roots: string[] | undefined, cwd: string) => {
    const read = inputFilesFrom({}, { cwd });
    const server = new McpServer({ name: "t", version: "0" });
    server.registerTool("read_it", { inputSchema: { path: z.string() } }, async ({ path }: { path: string }) => {
      const file = await read({ path }).catch((t: unknown) => ({ failed: String((t as { error?: { code?: string } }).error?.code ?? t) }));
      return { content: [{ type: "text" as const, text: JSON.stringify("bytes" in file ? file.bytes.toString() : file) }] };
    });
    shareRootsOf(server, 2000);
    const client = new Client({ name: "c", version: "0" }, roots === undefined ? {} : { capabilities: { roots: { listChanged: true } } });
    const asked = { count: 0, roots };
    if (roots !== undefined) {
      client.setRequestHandler("roots/list", async () => {
        asked.count += 1;
        return { roots: (asked.roots ?? []).map((dir) => ({ uri: pathToFileURL(dir).href })) };
      });
    }
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a as Transport);
    await client.connect(b as Transport);
    const call = async (path: string) =>
      JSON.parse(((await client.callTool({ name: "read_it", arguments: { path } })) as unknown as { content: [{ text: string }] }).content[0].text) as unknown;
    return { read, client, asked, call };
  };

  const folder = async (name: string, content: string) => {
    const dir = await mkdtemp(join(tmpdir(), `roots-${name}-`));
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "note.txt"), content);
    return dir;
  };

  it("reads from the folders the client shares, asks once, and again after it says they changed", async () => {
    const first = await folder("first", "from the first workspace");
    const second = await folder("second", "from the second workspace");
    const cwd = await folder("cwd", "from the working directory");
    const { client, asked, call, read } = await connect([first], cwd);
    expect(read.help).toMatch(/workspace folders/);
    expect(await call("note.txt")).toBe("from the first workspace");
    expect(await call(join(first, "note.txt"))).toBe("from the first workspace");
    expect(await call(join(cwd, "note.txt"))).toEqual({ failed: "outside_roots" });
    expect(asked.count).toBe(1);

    asked.roots = [second];
    await client.sendRootsListChanged();
    await new Promise((r) => setTimeout(r, 20));
    expect(await call("note.txt")).toBe("from the second workspace");
    expect(asked.count).toBe(2);
  });

  it("falls back to the working directory for a client that shares no roots", async () => {
    const cwd = await folder("cwd", "from the working directory");
    const { call } = await connect(undefined, cwd);
    expect(await call("note.txt")).toBe("from the working directory");
  });

  it("never asks over HTTP or where the deployment names its roots", async () => {
    const inbox = await folder("inbox", "x");
    expect(inputFilesFrom({ MCP_FILE_ROOTS: inbox }).help).not.toMatch(/workspace folders/);
    expect(inputFilesFrom({ MCP_HTTP_PORT: "1" }).help).toMatch(/takes no paths here/);
  });
});
