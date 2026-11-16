import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { failureText, forwardMcp } from "../src/forward.js";
import { startRelay, type Started } from "../src/relay.js";
import { settingsFrom } from "../src/settings.js";
import { closeUpstreams, type Upstream, upstreamsAt, withoutTokens } from "../src/upstream.js";
import { loadUpstreamTokens } from "../src/upstreamTokens.js";
import { fakeUpstream, relayTo, sha256, type Seen } from "./harness.js";

/**
 * A relay with one token for each of its clients upstream. Alice and bob
 * present their own tokens to the relay, the relay presents theirs upstream,
 * and the fake server records which it was.
 */
const own = { alice: "alice-own-token-0123456789abcdef", bob: "bob-own-token-0123456789abcdef" };
const up = { alice: "alice-upstream-token-0123456789", bob: "bob-upstream-token-0123456789ab" };

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
};

/** Files named by their folder, written with a trailing newline as an editor leaves them. */
const writeAll = async (dir: string, files: Record<string, string>): Promise<void> => {
  await mkdir(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) await writeFile(join(dir, name), contents);
};

type Folders = {
  /** token-<client> files in MCP_HTTP_TOKENS_DIR; the same folder as the upstream files when `same` is set. */
  readonly clients?: Record<string, string>;
  /** upstream-<client> files, as they are written, in MCP_RELAY_UPSTREAM_TOKENS_DIR. */
  readonly upstreams?: Record<string, string>;
  readonly same?: boolean;
  readonly env?: Record<string, string>;
};

const prefixed = (prefix: string, tokens: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(tokens).map(([client, token]) => [`${prefix}${client}`, `${token}\n`]));

const clientsOf = (entries: Record<string, string> | undefined): Record<string, string> => entries ?? own;
const upstreamsOf = (entries: Record<string, string> | undefined): Record<string, string> => entries ?? up;

/** The settings of a relay in front of `upstreamUrl` whose upstream tokens come from a folder. */
const folderSettings = async (upstreamUrl: string, { clients, upstreams, same = false, env = {} }: Folders = {}) => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-relay-client-tokens-"));
  const [tokens, upstreamTokens, localIn, localOut] = ["tokens", same ? "tokens" : "upstream-tokens", "in", "out"].map((name) => join(dir, name)) as [string, string, string, string];
  await writeAll(tokens, prefixed("token-", clientsOf(clients)));
  await writeAll(upstreamTokens, prefixed("upstream-", upstreamsOf(upstreams)));
  await mkdir(localIn, { recursive: true });
  await mkdir(localOut, { recursive: true });
  const settings = settingsFrom({
    MCP_HTTP_PORT: "0",
    MCP_HTTP_TOKENS_DIR: tokens,
    MCP_RELAY_UPSTREAM: upstreamUrl,
    MCP_RELAY_UPSTREAM_TOKENS_DIR: upstreamTokens,
    MCP_RELAY_INBOX: localIn,
    MCP_RELAY_OUTBOX: localOut,
    ...env,
  });
  return { dir, tokens, upstreamTokens, localIn, localOut, settings };
};

const startFolderRelay = async (upstreamUrl: string, folders: Folders = {}) => {
  const made = await folderSettings(upstreamUrl, folders);
  const log: string[] = [];
  const relay: Started = await startRelay({ settings: made.settings, log: (line) => log.push(line) });
  return { ...made, relay, log, url: `http://127.0.0.1:${relay.port}/mcp`, close: () => relay.close() };
};

const post = (url: string, token: string, body: unknown): Promise<Response> =>
  fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });

const readCall = (id: number, path: string) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "read", arguments: { path } } });

const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list" };

const bearer = (seen: Seen): string => String(seen.headers["authorization"]);

/**
 * A server of the kit's file endpoints and a tool, in miniature: it takes the
 * file a call names, answers the call with a link to a file in the outbox
 * named after it, and serves that file.
 */
const server = async (options: { readonly onRequest?: (req: IncomingMessage, res: ServerResponse, seen: Seen) => boolean } = {}) => {
  const where = { in: "", out: "" };
  const upstream = await fakeUpstream((req, res, seen) => {
    if (options.onRequest?.(req, res, seen) === true) return;
    const url = req.url ?? "";
    if (req.method === "PUT") return json(res, 200, { path: join(where.in, decodeURIComponent(url.slice("/files/inbox/".length))), size: seen.body.length, sha256: sha256(seen.body) });
    if (req.method === "GET") {
      const report = `report of ${decodeURIComponent(url.slice("/files/outbox/".length))}`;
      return void res.writeHead(200, { "content-length": String(Buffer.byteLength(report)), "x-content-sha256": sha256(report) }).end(report);
    }
    const message = JSON.parse(seen.body.toString()) as { id: number; method: string; params?: { arguments: { path: string } } };
    if (message.method !== "tools/call" || message.params === undefined) return json(res, 200, { jsonrpc: "2.0", id: message.id, result: {} });
    json(res, 200, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "called" }, { type: "resource_link", uri: `file://${where.out}/${basename(message.params.arguments.path)}`, name: "report" }] } });
  });
  return { ...upstream, where };
};

describe("a relay with a token upstream for each client", () => {
  it("sends each client's call, the file it uploads and the file it fetches with that client's token", async () => {
    const upstream = await server();
    const relay = await startFolderRelay(upstream.url);
    upstream.where.in = relay.localIn;
    upstream.where.out = relay.localOut;
    try {
      for (const client of ["alice", "bob"] as const) await writeFile(join(relay.localIn, `${client}-scan.txt`), `pages of ${client}`);
      // Together, so that nothing but the token each call is made with can tell the requests apart.
      const answers = await Promise.all(
        (["alice", "bob"] as const).map(async (client, at) => (await post(relay.url, own[client], readCall(at + 1, join(relay.localIn, `${client}-scan.txt`)))).json() as Promise<{ result: { content: { uri?: string }[] } }>),
      );
      expect(answers.map((a) => a.result.content[1]?.uri)).toEqual([`file://${relay.localOut}/alice-scan.txt`, `file://${relay.localOut}/bob-scan.txt`]);
      expect(await readFile(join(relay.localOut, "alice-scan.txt"), "utf8")).toBe("report of alice-scan.txt");
      expect(await readFile(join(relay.localOut, "bob-scan.txt"), "utf8")).toBe("report of bob-scan.txt");

      for (const client of ["alice", "bob"] as const) {
        const mine = upstream.seen.filter((s) => `${s.url} ${s.body.toString()}`.includes(`${client}-scan`));
        expect(mine.map((s) => [s.method, s.url.split("/").slice(0, 3).join("/")]).sort()).toEqual([
          ["GET", "/files/outbox"],
          ["POST", "/mcp"],
          ["PUT", "/files/inbox"],
        ]);
        expect(mine.map(bearer)).toEqual(mine.map(() => `Bearer ${up[client]}`));
      }
      expect(upstream.seen).toHaveLength(6);
      // What a client presents to the relay stays with the relay.
      expect(JSON.stringify(upstream.seen.map((s) => s.headers))).not.toMatch(/own-token/);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("serves every client from one pool of connections", async () => {
    const upstream = await server();
    const relay = await startFolderRelay(upstream.url);
    let connections = 0;
    upstream.server.on("connection", () => (connections += 1));
    try {
      for (const client of ["alice", "bob", "bob", "alice"] as const) {
        const answer = await post(relay.url, own[client], listTools);
        expect(answer.status).toBe(200);
        await answer.text();
      }
      expect(upstream.seen.map(bearer)).toEqual([up.alice, up.bob, up.bob, up.alice].map((token) => `Bearer ${token}`));
      expect(connections).toBe(1);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("says in its start line that each client has a token of its own, and no token", async () => {
    const upstream = await server();
    const relay = await startFolderRelay(upstream.url);
    try {
      const line = relay.log.find((l) => l.startsWith("relay: listening")) as string;
      expect(line).toContain("for alice, bob;");
      expect(line).toContain("with a token of its own for each client");
      expect(relay.log.join("\n")).not.toMatch(new RegExp(Object.values({ ...up, ...own }).join("|")));
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("works from the folder of the clients' own tokens, whose files it does not mistake for each other's", async () => {
    const upstream = await server();
    const relay = await startFolderRelay(upstream.url, { same: true });
    upstream.where.in = relay.localIn;
    upstream.where.out = relay.localOut;
    try {
      expect(relay.tokens).toBe(relay.upstreamTokens);
      const line = relay.log.find((l) => l.startsWith("relay: listening")) as string;
      expect(line).toContain("for alice, bob;");
      expect((await post(relay.url, own.bob, listTools)).status).toBe(200);
      expect(upstream.seen.map(bearer)).toEqual([`Bearer ${up.bob}`]);
      // An upstream token is no client's token.
      expect((await post(relay.url, up.alice, listTools)).status).toBe(401);
      expect(upstream.seen).toHaveLength(1);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("uses the token of `default` for a relay with one client token in a file, or of the client that file is named for", async () => {
    for (const [named, client] of [[{}, "default"], [{ MCP_HTTP_TOKEN_CLIENT: "carol" }, "carol"]] as const) {
      const upstream = await server();
      const made = await folderSettings(upstream.url, { upstreams: { [client]: up.alice } });
      const settings = settingsFrom({
        MCP_HTTP_PORT: "0",
        MCP_HTTP_TOKEN_FILE: join(made.tokens, "token-alice"),
        ...named,
        MCP_RELAY_UPSTREAM: upstream.url,
        MCP_RELAY_UPSTREAM_TOKENS_DIR: made.upstreamTokens,
      });
      const relay = await startRelay({ settings, log: () => undefined });
      try {
        expect((await post(`http://127.0.0.1:${relay.port}/mcp`, own.alice, listTools)).status).toBe(200);
        expect(upstream.seen.map(bearer)).toEqual([`Bearer ${up.alice}`]);
      } finally {
        await relay.close();
        await upstream.close();
      }
      // A folder with a file for some other client does not do.
      await expect(startRelay({ settings: { ...settings, upstreamTokens: { kind: "dir", dir: made.tokens } }, log: () => undefined })).rejects.toThrow(new RegExp(`${client} \\(upstream-${client} is missing\\)`));
    }
  });

  it("ignores the upstream file of a client it does not have, and needs none for a client whose own token is blank", async () => {
    const upstream = await server();
    const relay = await startFolderRelay(upstream.url, {
      clients: { ...own, carol: "" },
      upstreams: { ...up, dave: "dave-upstream-token-0123456789a" },
    });
    try {
      const line = relay.log.find((l) => l.startsWith("relay: listening")) as string;
      expect(line).toContain("for alice, bob;");
      expect((await post(relay.url, own.alice, listTools)).status).toBe(200);
      expect(upstream.seen.map(bearer)).toEqual([`Bearer ${up.alice}`]);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("a relay that would have no token upstream for a client", () => {
  const refuses = async (folders: Folders) => {
    const made = await folderSettings("http://127.0.0.1:9", folders);
    const log: string[] = [];
    const error = await startRelay({ settings: made.settings, log: (line) => log.push(line) }).then(
      async (relay) => {
        await relay.close();
        return undefined;
      },
      (thrown: unknown) => thrown as Error,
    );
    expect(log).toEqual([]);
    return error?.message;
  };

  it.each([
    ["has no file for it", { upstreams: { alice: up.alice } }, /no usable token for a client of this relay: bob \(upstream-bob is missing\)/],
    ["has a file with nothing in it", { upstreams: { ...up, bob: "" } }, /bob \(upstream-bob is empty\)/],
    ["has a file with only a line end in it", { upstreams: { ...up, bob: "   \n\n" } }, /bob \(upstream-bob is empty\)/],
  ] as const)("is refused when its folder %s", async (_what, folders, message) => {
    const said = await refuses(folders);
    expect(said).toMatch(message);
    expect(said).toContain("MCP_RELAY_UPSTREAM_TOKENS_DIR");
    // Only the client that has a problem is named, and no token is.
    expect(said).not.toContain("alice");
    expect(said).not.toContain(up.alice);
    expect(said).not.toContain(own.bob);
  });

  it("names every client without a token, not the first", async () => {
    const said = await refuses({ clients: { ...own, carol: "carol-own-token-0123456789abcd" }, upstreams: { alice: up.alice, carol: "  " } });
    expect(said).toMatch(/no usable token for some clients of this relay: bob \(upstream-bob is missing\), carol \(upstream-carol is empty\)/);
    expect(said).not.toContain("alice");
  });

  it("is refused when the file cannot be read, and says why", async () => {
    const made = await folderSettings("http://127.0.0.1:9");
    // A folder where the file should be.
    await mkdir(join(made.upstreamTokens, "upstream-carol"));
    await writeFile(join(made.tokens, "token-carol"), "carol-own-token-0123456789abcd\n");
    await expect(startRelay({ settings: made.settings, log: () => undefined })).rejects.toThrow(/carol \(upstream-carol cannot be read: EISDIR\)/);
  });

  it("does not read a file outside the folder for a client name with a slash in it, and says the name is the trouble", async () => {
    const made = await folderSettings("http://127.0.0.1:9");
    await writeFile(join(made.dir, "tokenfile"), `${up.alice}\n`);
    const said = await loadUpstreamTokens({ kind: "dir", dir: made.upstreamTokens }, ["x/../../tokenfile"]).then(
      () => "",
      (thrown: unknown) => (thrown as Error).message,
    );
    expect(said).toContain('"x/../../tokenfile" (not a name a file can have, so there can be no upstream-<client> file for it');
    expect(said).not.toContain("is missing");
    expect(said).not.toContain(up.alice);
  });

  it("is refused when the one token file is empty, as a relay with one token always was", async () => {
    const made = await folderSettings("http://127.0.0.1:9");
    await writeFile(join(made.dir, "upstream-token"), "\n");
    const settings = settingsFrom({ MCP_HTTP_PORT: "0", MCP_HTTP_TOKENS_DIR: made.tokens, MCP_RELAY_UPSTREAM: "http://127.0.0.1:9", MCP_RELAY_UPSTREAM_TOKEN_FILE: join(made.dir, "upstream-token") });
    await expect(startRelay({ settings, log: () => undefined })).rejects.toThrow(/upstream-token \(MCP_RELAY_UPSTREAM_TOKEN_FILE\) is empty/);
  });
});

describe("a relay with one token for all its clients", () => {
  it("presents that token for each, and says so in its start line", async () => {
    const upstream = await server();
    const made = await folderSettings(upstream.url);
    const file = join(made.dir, "upstream-token");
    await writeFile(file, `${up.alice}\n`);
    const log: string[] = [];
    const relay = await startRelay({ settings: { ...made.settings, upstreamTokens: { kind: "file", file } }, log: (line) => log.push(line) });
    try {
      for (const client of ["alice", "bob"] as const) expect((await post(`http://127.0.0.1:${relay.port}/mcp`, own[client], listTools)).status).toBe(200);
      expect(upstream.seen.map(bearer)).toEqual([`Bearer ${up.alice}`, `Bearer ${up.alice}`]);
      expect(log.find((l) => l.startsWith("relay: listening"))).toContain("with one token for all clients");
      // One line, apart from the rest: these two clients are one client to the server.
      const warnings = log.filter((l) => l.includes("WARNING"));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("every client of this relay (alice, bob) the same token upstream");
      expect(warnings[0]).toContain("same rights");
      expect(warnings[0]).toContain("MCP_RELAY_UPSTREAM_TOKENS_DIR");
      expect(log.join("\n")).not.toContain(up.alice);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("what the upstream says about a token", () => {
  /** Quotes the tokens of every client, as a careless server's error might. */
  const quoting = `denied ${up.alice} and ${up.bob} and ${up.alice}`;

  it("never reaches a client with any client's token in it, from a failed call, a file not sent or a file not fetched", async () => {
    const upstream = await server({
      onRequest: (req, res) => {
        if (req.method === "POST") return false;
        res.writeHead(401, { "content-type": "text/plain" }).end(`${quoting}\n`);
        return true;
      },
    });
    const relay = await startFolderRelay(upstream.url);
    upstream.where.in = relay.localIn;
    upstream.where.out = relay.localOut;
    try {
      // A file to send: refused for the token, and the call is not made.
      await writeFile(join(relay.localIn, "scan.txt"), "pages");
      const upload = await (await post(relay.url, own.bob, readCall(1, join(relay.localIn, "scan.txt")))).json();
      expect(JSON.stringify(upload)).toContain("refused the relay's token for bob (401); check upstream-bob in MCP_RELAY_UPSTREAM_TOKENS_DIR");
      expect(JSON.stringify(upload)).not.toContain(up.alice);
      expect(JSON.stringify(upload)).not.toContain(up.bob);

      // No file to send: the call goes, and the link in its answer cannot be fetched.
      const fetched = (await (await post(relay.url, own.alice, readCall(2, "/nowhere/report.txt"))).json()) as { result: { content: { text?: string; uri?: string }[] } };
      const note = fetched.result.content.at(-1)?.text as string;
      expect(note).toContain("refused the relay's token for alice (401); check upstream-alice in MCP_RELAY_UPSTREAM_TOKENS_DIR");
      expect(note).toContain("[token]");
      expect(JSON.stringify(fetched)).not.toContain(up.alice);
      expect(JSON.stringify(fetched)).not.toContain(up.bob);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it.each([
    [401, 502, /the upstream refused the relay's token for alice \(401\); check upstream-alice in MCP_RELAY_UPSTREAM_TOKENS_DIR/],
    [403, 502, /the upstream refused the relay's token for alice \(403\); check upstream-alice in MCP_RELAY_UPSTREAM_TOKENS_DIR/],
    [500, 500, /the upstream failed \(500\): denied \[token\] and \[token\] and \[token\]/],
  ])("takes every client's token out of the words about a %i, which are about the client that called", async (status, relayed, words) => {
    const upstream = await server({
      onRequest: (_req, res) => {
        res.writeHead(status, { "content-type": "text/plain" }).end(`${quoting}\n`);
        return true;
      },
    });
    const relay = await startFolderRelay(upstream.url);
    try {
      const answer = await post(relay.url, own.alice, listTools);
      expect(answer.status).toBe(relayed);
      const text = await answer.text();
      expect(text).toMatch(words);
      expect(text).not.toContain(up.alice);
      expect(text).not.toContain(up.bob);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("is taken out of whatever a token is the start of, longest first", () => {
    const short = "shared-start-0123456789";
    const long = `${short}-and-more-0123456789`;
    const { byClient, pool } = upstreamsAt("http://127.0.0.1:9", { mode: "per-client", byClient: new Map([["alice", short], ["bob", long]]) });
    try {
      const alice = byClient.get("alice");
      if (alice === undefined) throw new Error("no upstream for alice");
      expect(withoutTokens(`one ${long} two ${short} three`, alice)).toBe("one [token] two [token] three");
    } finally {
      closeUpstreams({ pool, byClient });
    }
  });
});

describe("a relay whose clients would present the same token upstream", () => {
  const refuses = async (folders: Folders): Promise<string> => {
    const made = await folderSettings("http://127.0.0.1:9", folders);
    const log: string[] = [];
    const said = await startRelay({ settings: made.settings, log: (line) => log.push(line) }).then(
      async (relay) => {
        await relay.close();
        return "";
      },
      (thrown: unknown) => (thrown as Error).message,
    );
    // Nothing listened, nothing was logged.
    expect(log).toEqual([]);
    return said;
  };

  it("is refused at start, naming the clients and the setting that shares a token on purpose, and never the token", async () => {
    const said = await refuses({ upstreams: { alice: up.alice, bob: up.alice } });
    expect(said).toContain("has the same token in the upstream-<client> files of alice and bob.");
    expect(said).toContain("MCP_RELAY_UPSTREAM_TOKEN_FILE");
    expect(said).not.toContain(up.alice);
    expect(said).not.toContain(up.bob);
  });

  it("counts a token the same however its file is written", async () => {
    const said = await refuses({ upstreams: { alice: up.alice, bob: `  ${up.alice}  \n\n` } });
    expect(said).toContain("files of alice and bob.");
  });

  it("names every group of clients that share, and leaves out a client with a token of its own", async () => {
    const said = await refuses({
      clients: { ...own, carol: "carol-own-token-0123456789abcd", dave: "dave-own-token-0123456789abcde", erin: "erin-own-token-0123456789abcde" },
      upstreams: { alice: up.alice, bob: up.alice, carol: up.bob, dave: up.bob, erin: "erin-upstream-token-0123456789" },
    });
    expect(said).toContain("files of alice and bob; another token is shared by carol and dave.");
    expect(said).not.toContain("erin");
    expect(said).not.toContain(up.alice);
    expect(said).not.toContain(up.bob);
  });

  it("names three clients that share as a list", async () => {
    const said = await refuses({ clients: { ...own, carol: "carol-own-token-0123456789abcd" }, upstreams: { alice: up.bob, bob: up.bob, carol: up.bob } });
    expect(said).toContain("files of alice, bob and carol.");
  });

  it("names a file that is wrong before it asks about sharing", async () => {
    const said = await refuses({ upstreams: { alice: up.alice, bob: "" } });
    expect(said).toContain("bob (upstream-bob is empty)");
    expect(said).not.toContain("same token");
  });
});

describe("a relay that is given a token that is not one", () => {
  const refuses = async (folders: Folders): Promise<string> => {
    const made = await folderSettings("http://127.0.0.1:9", folders);
    return startRelay({ settings: made.settings, log: () => undefined }).then(
      async (relay) => {
        await relay.close();
        return "";
      },
      (thrown: unknown) => (thrown as Error).message,
    );
  };

  it.each([
    ["a space", "part-one-0123456789 part-two-0123456789"],
    ["a tab", "part-one-0123456789\tpart-two-0123456789"],
    ["a line end", "part-one-0123456789\npart-two-0123456789"],
    ["a carriage return", "part-one-0123456789\r\npart-two-0123456789"],
    ["a space that is not the usual one", "part-one-0123456789 part-two-0123456789"],
    ["a control character", "part-one-0123456789\u0007part-two-0123456789"],
    ["a NUL", "part-one-0123456789\u0000part-two-0123456789"],
    ["a delete character", "part-one-0123456789\u007fpart-two-0123456789"],
    ["a pasted zero-width space", "part-one-0123456789​part-two-0123456789"],
    ["a letter outside ASCII", "part-one-0123456789épart-two-0123456789"],
  ])("is refused at start when its token has %s inside, and no part of the token is in the words", async (_what, token) => {
    const said = await refuses({ upstreams: { ...up, bob: token } });
    expect(said).toContain("bob (upstream-bob has whitespace or a control character inside the token");
    expect(said).not.toContain("part-one");
    expect(said).not.toContain("part-two");
    expect(said).not.toContain("alice");
  });

  it("names every client whose token has something inside, not the first", async () => {
    const said = await refuses({ upstreams: { alice: "has a space", bob: "has\ttab" } });
    expect(said).toContain("some clients");
    expect(said).toContain("alice (upstream-alice has whitespace");
    expect(said).toContain("bob (upstream-bob has whitespace");
  });

  it("drops the white space at the ends of a token, as the line end of an editor", async () => {
    const made = await folderSettings("http://127.0.0.1:9");
    await writeFile(join(made.upstreamTokens, "upstream-alice"), `\n  ${up.alice}  \r\n\n`);
    const tokens = await loadUpstreamTokens({ kind: "dir", dir: made.upstreamTokens }, ["alice", "bob"]);
    expect(tokens.byClient.get("alice")).toBe(up.alice);
  });

  it("is refused at start when the one token file has something inside, and says which file", async () => {
    const made = await folderSettings("http://127.0.0.1:9");
    await writeFile(join(made.dir, "upstream-token"), "part-one-0123456789 part-two-0123456789\n");
    const settings = settingsFrom({ MCP_HTTP_PORT: "0", MCP_HTTP_TOKENS_DIR: made.tokens, MCP_RELAY_UPSTREAM: "http://127.0.0.1:9", MCP_RELAY_UPSTREAM_TOKEN_FILE: join(made.dir, "upstream-token") });
    const said = await startRelay({ settings, log: () => undefined }).then(
      () => "",
      (thrown: unknown) => (thrown as Error).message,
    );
    expect(said).toContain("upstream-token (MCP_RELAY_UPSTREAM_TOKEN_FILE) has whitespace or a control character inside the token");
    expect(said).not.toContain("part-one");
  });
});

describe("a client whose name cannot be a file name", () => {
  const names = ["../escape", "a/b", "a\\b", "nul\u0000byte", "n".repeat(250)];

  it.each(names)("is refused for %j, saying that it is the name and not that a file is missing", async (client) => {
    const made = await folderSettings("http://127.0.0.1:9");
    const said = await loadUpstreamTokens({ kind: "dir", dir: made.upstreamTokens }, ["alice", client]).then(
      () => "",
      (thrown: unknown) => (thrown as Error).message,
    );
    expect(said).toContain(`${JSON.stringify(client)} (not a name a file can have, so there can be no upstream-<client> file for it; a client name has no slash, backslash or NUL, and 255 bytes at most with the upstream- in front)`);
    expect(said).not.toContain("is missing");
    // Alice has a file and is not in it.
    expect(said).not.toContain("alice");
  });

  it("is refused at start when the name comes from MCP_HTTP_TOKEN_CLIENT, which is free text", async () => {
    const made = await folderSettings("http://127.0.0.1:9");
    const settings = settingsFrom({
      MCP_HTTP_PORT: "0",
      MCP_HTTP_TOKEN_FILE: join(made.tokens, "token-alice"),
      MCP_HTTP_TOKEN_CLIENT: "../escape",
      MCP_RELAY_UPSTREAM: "http://127.0.0.1:9",
      MCP_RELAY_UPSTREAM_TOKENS_DIR: made.upstreamTokens,
    });
    await expect(startRelay({ settings, log: () => undefined })).rejects.toThrow(/"\.\.\/escape" \(not a name a file can have/);
  });
});

describe("what a relay says at start about the clients that share a token", () => {
  it("says nothing of it for a single client, which shares with no one", async () => {
    const upstream = await server();
    const single = await relayTo(upstream.url);
    try {
      expect(single.log.filter((l) => l.includes("WARNING"))).toEqual([]);
    } finally {
      await single.close();
      await upstream.close();
    }
  });

  it("says nothing of it for clients with a token each", async () => {
    const upstream = await server();
    const relay = await startFolderRelay(upstream.url);
    try {
      expect(relay.log.filter((l) => l.includes("WARNING"))).toEqual([]);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("a stream a client opens", () => {
  it("is opened upstream with that client's token, and a file linked in its events is fetched with it", async () => {
    const where = { out: "" };
    const who = (req: IncomingMessage): string => (req.headers.authorization === `Bearer ${up.alice}` ? "alice" : req.headers.authorization === `Bearer ${up.bob}` ? "bob" : "nobody");
    const upstream = await server({
      onRequest: (req, res) => {
        if (req.method !== "GET" || req.url !== "/mcp") return false;
        const client = who(req);
        const message = { jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: `news for ${client}` }, { type: "resource_link", uri: `file://${where.out}/${client}-news.txt`, name: "news" }] } };
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": the stream is open\n\n");
        res.end(`event: message\nid: ${client}-1\ndata: ${JSON.stringify(message)}\n\n`);
        return true;
      },
    });
    const relay = await startFolderRelay(upstream.url);
    where.out = relay.localOut;
    try {
      const open = (client: "alice" | "bob"): Promise<string> =>
        fetch(relay.url, { headers: { authorization: `Bearer ${own[client]}`, accept: "text/event-stream" } }).then((answer) => {
          expect(answer.headers.get("content-type")).toBe("text/event-stream");
          return answer.text();
        });
      const [alice, bob] = await Promise.all([open("alice"), open("bob")]);

      // The server answered each stream for the client whose token opened it, and the event came through with its link.
      expect(alice).toContain("news for alice");
      expect(alice).not.toContain("news for bob");
      expect(bob).toContain("news for bob");
      expect(bob).not.toContain("news for alice");
      expect(alice).toContain(`id: alice-1\n`);
      expect(await readFile(join(relay.localOut, "alice-news.txt"), "utf8")).toBe("report of alice-news.txt");
      expect(await readFile(join(relay.localOut, "bob-news.txt"), "utf8")).toBe("report of bob-news.txt");

      // The file each event linked was fetched with the token of the client whose stream carried it.
      const fetched = upstream.seen.filter((s) => s.url.startsWith("/files/outbox/"));
      expect(fetched.map((s) => [s.url.split("/").at(-1), bearer(s)]).sort()).toEqual([
        ["alice-news.txt", `Bearer ${up.alice}`],
        ["bob-news.txt", `Bearer ${up.bob}`],
      ]);
      const streams = upstream.seen.filter((s) => s.url === "/mcp");
      expect(streams.map(bearer).sort()).toEqual([`Bearer ${up.alice}`, `Bearer ${up.bob}`]);
      expect(`${alice}${bob}`).not.toMatch(/upstream-token|own-token/);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("a request that fails inside the relay", () => {
  /** A relay whose limits cannot be read, which is a fault in the relay itself: the error is what the log is for. */
  const failing = async (error: Error) => {
    const { byClient, pool } = upstreamsAt("http://127.0.0.1:9", { mode: "per-client", byClient: new Map([["alice", up.alice], ["bob", up.bob]]) });
    const log: string[] = [];
    const relay = {
      limits: {
        get maxBodyBytes(): number {
          throw error;
        },
        timeoutMs: 5000,
        ratePerSec: 100,
        burst: 100,
      },
      transfer: { upstream: byClient.get("alice") as Upstream, maxFileBytes: 1024, log: (line: string) => log.push(line) },
    };
    const http = createServer((req, res) => void forwardMcp(relay, req, res));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    return {
      log,
      url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
      close: async () => {
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
        closeUpstreams({ pool, byClient });
      },
    };
  };

  it("goes to the relay's log, with the cause of the error in it and no client's token", async () => {
    const cause = new Error(`the socket to the server hung up while it quoted ${up.bob}`);
    const relay = await failing(new Error(`could not write the request for ${up.alice}`, { cause }));
    try {
      const answer = await post(relay.url, "any", listTools);
      expect(answer.status).toBe(500);
      expect((await answer.text()).trim()).toBe("internal error");

      expect(relay.log).toHaveLength(1);
      const line = relay.log[0] as string;
      expect(line).toMatch(/^relay: request failed: Error: could not write the request for \[token\]\n/);
      expect(line).toContain("\ncaused by: Error: the socket to the server hung up while it quoted [token]");
      expect(line).not.toContain(up.alice);
      expect(line).not.toContain(up.bob);
    } finally {
      await relay.close();
    }
  });
});

describe("failureText", () => {
  const { byClient, pool } = upstreamsAt("http://127.0.0.1:9", { mode: "per-client", byClient: new Map([["alice", up.alice], ["bob", up.bob]]) });
  const upstream = byClient.get("alice") as Upstream;

  it("follows the causes, whatever they are, and takes every token out of all of them", () => {
    const text = failureText(new Error(`outer ${up.alice}`, { cause: new Error(`middle ${up.bob}`, { cause: `a plain string with ${up.alice}` }) }), upstream);
    const parts = text.split("\ncaused by: ");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^Error: outer \[token\]\n/);
    expect(parts[1]).toMatch(/^Error: middle \[token\]\n/);
    expect(parts[2]).toBe("a plain string with [token]");
  });

  it("says a value that is not an error, and stops at a cause that leads back to itself", () => {
    expect(failureText(`oops ${up.alice}`, upstream)).toBe("oops [token]");
    const loop = new Error("loop");
    loop.cause = loop;
    expect(failureText(loop, upstream).split("\ncaused by: ")).toHaveLength(1);
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(failureText(a, upstream).split("\ncaused by: ")).toHaveLength(2);
  });

  it("stops after a few causes", () => {
    const deep = Array.from({ length: 20 }).reduce<Error>((cause, _, at) => new Error(`level ${at}`, { cause }), new Error("root"));
    expect(failureText(deep, upstream).split("\ncaused by: ").length).toBeLessThan(10);
    closeUpstreams({ pool, byClient });
  });
});
