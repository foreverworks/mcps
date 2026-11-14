import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  asInputFileError,
  type Client,
  McpServer,
  PROGRESS_INTERVAL_MS,
  readInputFile,
  reportProgress,
  resourceLinkTo,
  saveToOutbox,
  serve,
  type Served,
  StreamableHTTPClientTransport,
  testClient,
  type ProtocolEra,
} from "@foreverworks/mcp-kit";
import { z } from "zod";

import { startRelay, type Started } from "../src/relay.js";
import { settingsFrom } from "../src/settings.js";

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/**
 * Two machines on one disk. The server's folders and the relay's are different
 * directories here, where in a deployment they are the same absolute paths on
 * two machines; the fake server's tools translate between the two (`asRemote`,
 * `asLocal`), which is what the shared path makes unnecessary for a real one.
 * Everything else is real: the kit's own server with both file endpoints on,
 * the relay in front of it, HTTP on loopback ports.
 */
export type World = {
  readonly dir: string;
  readonly remoteIn: string;
  readonly remoteOut: string;
  readonly localIn: string;
  readonly localOut: string;
  readonly upstream: Served;
  readonly upstreamUrl: string;
  readonly upstreamToken: string;
  readonly upstreamAudit: string[];
  readonly relay: Started;
  readonly relayUrl: string;
  readonly relayToken: string;
  readonly relayLog: string[];
  readonly close: () => Promise<void>;
};

export const upstreamToken = "upstream-token-0123456789abcdef";
export const relayToken = "relay-client-token-0123456789abcdef";

export type WorldOptions = {
  /** MCP_HTTP_FILES_MAX_BYTES of the server. */
  readonly serverMaxBytes?: number;
  /** Extra settings for the relay, over the usual ones. */
  readonly relayEnv?: Record<string, string>;
  /** The token the relay presents upstream, when it should not be the right one. */
  readonly presentedToken?: string;
};

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export const startWorld = async (options: WorldOptions = {}): Promise<World> => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-relay-world-"));
  const [remoteIn, remoteOut, localIn, localOut, upstreamTokens, relayTokens] = ["remote/in", "remote/out", "local/in", "local/out", "remote/tokens", "local/tokens"].map((name) => join(dir, name));
  for (const folder of [remoteIn, remoteOut, localIn, localOut, upstreamTokens, relayTokens]) await mkdir(folder as string, { recursive: true });
  await writeFile(join(upstreamTokens as string, "token-relay"), `${upstreamToken}\n`);
  await writeFile(join(relayTokens as string, "token-alice"), `${relayToken}\n`);
  await writeFile(join(dir, "upstream-token"), `${options.presentedToken ?? upstreamToken}\n`);
  const asRemote = (path: string): string => (path.startsWith(localIn as string) ? `${remoteIn}${path.slice((localIn as string).length)}` : path);
  const asLocal = (path: string): string => `${localOut}${path.slice((remoteOut as string).length)}`;

  const register = (server: McpServer): void => {
    server.registerTool("save_report", { description: "saves a text file into the outbox and links it", inputSchema: { name: z.string(), text: z.string(), folder: z.string().optional() } }, async ({ name, text: body, folder }) => {
      const saved = await saveToOutbox(join(remoteOut as string, folder ?? ""), name, body);
      return { content: [{ type: "text" as const, text: JSON.stringify({ saved: name, sha256: saved.sha256 }) }, resourceLinkTo(asLocal(saved.path), saved.size)] };
    });
    server.registerTool("save_blob", { description: "saves bytes of a known pattern and links them", inputSchema: { name: z.string(), size: z.number() } }, async ({ name, size }) => {
      const bytes = Buffer.alloc(size);
      for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
      const saved = await saveToOutbox(remoteOut as string, name, bytes);
      return { content: [{ type: "text" as const, text: JSON.stringify({ sha256: saved.sha256 }) }, resourceLinkTo(asLocal(saved.path), saved.size)] };
    });
    server.registerTool("count_and_save", { description: "reports progress, then saves a file and links it", inputSchema: { name: z.string(), text: z.string() } }, async ({ name, text: body }) => {
      reportProgress(1, 2, "half way");
      await new Promise((resolve) => setTimeout(resolve, PROGRESS_INTERVAL_MS + 40));
      const saved = await saveToOutbox(remoteOut as string, name, body);
      return { content: [{ type: "text" as const, text: "counted" }, resourceLinkTo(asLocal(saved.path), saved.size)] };
    });
    server.registerTool("link_to", { description: "answers with links to wherever it is told", inputSchema: { uris: z.array(z.string()) } }, async ({ uris }) => ({
      content: [{ type: "text" as const, text: "links" }, ...uris.map((uri) => ({ type: "resource_link" as const, uri, name: "linked" }))],
    }));
    server.registerTool("read_input", { description: "reads a file from the inbox by path", inputSchema: { path: z.string() } }, async ({ path }) => {
      try {
        const file = await readInputFile({ path: asRemote(path) }, { roots: [remoteIn as string] });
        return text({ size: file.size, sha256: file.sha256, text: file.bytes.toString("utf8") });
      } catch (thrown) {
        return { ...text({ error: asInputFileError(thrown)?.message ?? String(thrown) }), isError: true };
      }
    });
    server.registerTool("read_inputs", { description: "reads several files from the inbox by path", inputSchema: { job: z.object({ paths: z.array(z.string()), note: z.string() }) } }, async ({ job }) => {
      const found: Record<string, string> = {};
      for (const path of job.paths) {
        try {
          found[path] = (await readInputFile({ path: asRemote(path) }, { roots: [remoteIn as string] })).bytes.toString("utf8");
        } catch (thrown) {
          found[path] = `error: ${asInputFileError(thrown)?.message ?? String(thrown)}`;
        }
      }
      return text(found);
    });
    server.registerTool("echo", { description: "answers with its arguments", inputSchema: { path: z.string(), more: z.array(z.string()).optional() } }, async (args) => text(args));
  };

  const upstreamAudit: string[] = [];
  const upstream = await serve({
    name: "fake",
    version: "0.0.0",
    register,
    policy: {
      save_report: { access: "write" },
      save_blob: { access: "write" },
      count_and_save: { access: "write" },
      link_to: { access: "read" },
      read_input: { access: "read" },
      read_inputs: { access: "read" },
      echo: { access: "read" },
    },
    env: {
      MCP_HTTP_PORT: "0",
      MCP_HTTP_TOKENS_DIR: upstreamTokens as string,
      MCP_HTTP_FILES_OUTBOX: remoteOut as string,
      MCP_HTTP_FILES_INBOX: remoteIn as string,
      ...(options.serverMaxBytes === undefined ? {} : { MCP_HTTP_FILES_MAX_BYTES: String(options.serverMaxBytes) }),
    },
    log: (line) => upstreamAudit.push(line),
  });
  const upstreamUrl = `http://127.0.0.1:${upstream.port}`;

  const relayLog: string[] = [];
  const settings = settingsFrom({
    MCP_HTTP_PORT: "0",
    MCP_HTTP_TOKENS_DIR: relayTokens as string,
    MCP_RELAY_UPSTREAM: upstreamUrl,
    MCP_RELAY_UPSTREAM_TOKEN_FILE: join(dir, "upstream-token"),
    MCP_RELAY_INBOX: localIn as string,
    MCP_RELAY_OUTBOX: localOut as string,
    ...options.relayEnv,
  });
  const relay = await startRelay({ settings, upstreamToken: options.presentedToken ?? upstreamToken, log: (line) => relayLog.push(line) });

  return {
    dir,
    remoteIn: remoteIn as string,
    remoteOut: remoteOut as string,
    localIn: localIn as string,
    localOut: localOut as string,
    upstream,
    upstreamUrl,
    upstreamToken,
    upstreamAudit,
    relay,
    relayUrl: `http://127.0.0.1:${relay.port}/mcp`,
    relayToken,
    relayLog,
    close: async () => {
      await relay.close();
      await upstream.close();
    },
  };
};

/** A client of the relay, as an agent's would be, connected with the local token. */
export const connectTo = async (world: Pick<World, "relayUrl" | "relayToken">, era: ProtocolEra = "legacy"): Promise<Client> => {
  const client = testClient("relay-test", era);
  await client.connect(new StreamableHTTPClientTransport(new URL(world.relayUrl), { requestInit: { headers: { authorization: `Bearer ${world.relayToken}` } } }));
  return client;
};

/** What a tool answered, as its first text item's JSON. */
export const jsonOf = (result: unknown): Record<string, unknown> => JSON.parse(((result as { content: { text: string }[] }).content[0] as { text: string }).text) as Record<string, unknown>;

export type Seen = { readonly method: string; readonly url: string; readonly headers: Record<string, string | string[] | undefined>; readonly body: Buffer };

/** A server of our own making, to stand in for an upstream that misbehaves, and to see exactly what the relay sent it. */
export const fakeUpstream = async (
  answer: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void,
): Promise<{ readonly url: string; readonly seen: Seen[]; readonly close: () => Promise<void>; readonly server: Server }> => {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const entry = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) };
      seen.push(entry);
      answer(req, res, entry);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    server,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
};

/** A relay in front of whatever `upstreamUrl` is, with one client token and a pair of local folders. */
export const relayTo = async (
  upstreamUrl: string,
  { token = upstreamToken, env = {} }: { readonly token?: string; readonly env?: Record<string, string> } = {},
): Promise<{ readonly relay: Started; readonly url: string; readonly log: string[]; readonly localIn: string; readonly localOut: string; readonly dir: string; readonly close: () => Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-relay-alone-"));
  const [tokens, localIn, localOut] = ["tokens", "in", "out"].map((name) => join(dir, name));
  for (const folder of [tokens, localIn, localOut]) await mkdir(folder as string, { recursive: true });
  await writeFile(join(tokens as string, "token-alice"), `${relayToken}\n`);
  await writeFile(join(dir, "upstream-token"), `${token}\n`);
  const log: string[] = [];
  const settings = settingsFrom({
    MCP_HTTP_PORT: "0",
    MCP_HTTP_TOKENS_DIR: tokens as string,
    MCP_RELAY_UPSTREAM: upstreamUrl,
    MCP_RELAY_UPSTREAM_TOKEN_FILE: join(dir, "upstream-token"),
    MCP_RELAY_INBOX: localIn as string,
    MCP_RELAY_OUTBOX: localOut as string,
    ...env,
  });
  const relay = await startRelay({ settings, upstreamToken: token, log: (line) => log.push(line) });
  return { relay, url: `http://127.0.0.1:${relay.port}/mcp`, log, localIn: localIn as string, localOut: localOut as string, dir, close: () => relay.close() };
};
