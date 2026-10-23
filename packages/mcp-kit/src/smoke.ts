/**
 * The client every live smoke script drives a server with, and the one place
 * that chooses how it reaches the server.
 *
 * With `MCP_URL` set it talks to a RUNNING server over HTTP: where a service
 * holds the grants under its own user, it is the only process that can make a
 * live call at all. The bearer token is read from `MCP_TOKEN_FILE`. Without it
 * the built server in the current directory is spawned over stdio, with the
 * environment given (this process's by default), which is how a developer's
 * own credentials are exercised.
 *
 *   MCP_URL=http://127.0.0.1:3000/mcp MCP_TOKEN_FILE=/path/to/token npx tsx scripts/smoke.ts
 */
import { readFileSync } from "node:fs";
import { Client, type ClientCapabilities, InMemoryTransport, StreamableHTTPClientTransport, type Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { McpServer, ProtocolEra } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

export type SmokeOptions = {
  /** The client's name, which the server's audit line records. */
  readonly name?: string;
  /** stdio only: the spawned server's whole environment. */
  readonly env?: Readonly<Record<string, string>>;
};

/** Where the smoke client connects, decided from the environment alone. */
export type SmokeTarget =
  | { readonly kind: "http"; readonly url: URL; readonly tokenFile: string }
  | { readonly kind: "stdio" };

export const smokeTarget = (env: NodeJS.ProcessEnv): SmokeTarget => {
  const url = env["MCP_URL"];
  if (!url) return { kind: "stdio" };
  const tokenFile = env["MCP_TOKEN_FILE"];
  if (!tokenFile) throw new Error("MCP_URL needs MCP_TOKEN_FILE, the file holding that service's bearer token");
  return { kind: "http", url: new URL(url), tokenFile };
};

/** This process's environment without its unset entries, as a child's environment. */
export const definedEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));

const transportFor = (target: SmokeTarget, childEnv: Readonly<Record<string, string>>): Transport =>
  target.kind === "http"
    ? new StreamableHTTPClientTransport(target.url, {
        requestInit: { headers: { authorization: `Bearer ${readFileSync(target.tokenFile, "utf8").trim()}` } },
      })
    : new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...childEnv } });

/** A connected client; the caller closes it. */
export const connectSmoke = async (options: SmokeOptions = {}): Promise<Client> => {
  const client = new Client({ name: options.name ?? "smoke", version: "1.0.0" });
  await client.connect(transportFor(smokeTarget(process.env), options.env ?? definedEnv(process.env)));
  return client;
};

/** A tool result's body: every tool here answers with one JSON text block. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolJson = (result: unknown): any =>
  JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

/** The guard's question begins with this; what follows is `<service>: <the policy's line>`. */
const CONFIRM_PREFIX = "Confirm? ";

/** What a server asks the person at a client: a form, or a page to open (MCP elicitation, 2025-11-25 shape). */
export type Elicited =
  | { readonly mode?: "form"; readonly message: string; readonly requestedSchema?: unknown }
  | { readonly mode: "url"; readonly message: string; readonly url: string; readonly elicitationId?: string };

/** What the person answered. */
export type ElicitAnswer = { readonly action: "accept" | "decline" | "cancel"; readonly content?: Readonly<Record<string, string | number | boolean | string[]>> };

/**
 * A client that answers every elicitation with `answer` and records each one
 * it was asked, declaring `capabilities` (form elicitation by default), for
 * tests and for a smoke script that answers what a server asks.
 */
export const elicitingClient = (
  name: string,
  answer: (asked: Elicited) => ElicitAnswer,
  elicitation: { readonly form?: Record<string, never>; readonly url?: Record<string, never> } = {},
  era: ProtocolEra = "legacy",
): { readonly client: Client; readonly asked: Elicited[] } => {
  const asked: Elicited[] = [];
  const client = testClient(name, era, { elicitation });
  // One handler for both generations: in 2026-07-28 the SDK's client answers the question a
  // call returns through it and retries the call with the answer.
  client.setRequestHandler("elicitation/create", async (request) => {
    const params = request.params as Elicited;
    asked.push(params);
    return answer(params);
  });
  return { client, asked };
};

/**
 * A client that answers the guard's confirmations (MCP_CONFIRM=elicit) with
 * `answer(line)` and records every line it was asked, for tests and for a smoke
 * script that should confirm what it runs.
 */
export const confirmingClient = (
  name: string,
  answer: (line: string) => boolean = () => true,
  era: ProtocolEra = "legacy",
): { readonly client: Client; readonly asked: string[] } => {
  const asked: string[] = [];
  const { client } = elicitingClient(
    name,
    ({ message }) => {
      const line = message.startsWith(CONFIRM_PREFIX) ? message.slice(CONFIRM_PREFIX.length) : message;
      asked.push(line);
      return { action: "accept", content: { confirm: answer(line) } };
    },
    {},
    era,
  );
  return { client, asked };
};

/** The protocol generation each test client was made for, so connectInMemory serves it the matching way. */
const eras = new WeakMap<Client, ProtocolEra>();

/**
 * A client of one protocol generation: `legacy` speaks 2025-11-25 (the SDK's
 * default, and what every client spoke before 2026-07-28), `modern` is pinned
 * to 2026-07-28.
 */
export const testClient = (name: string, era: ProtocolEra = "legacy", capabilities: ClientCapabilities = {}): Client => {
  const client = new Client({ name, version: "1.0.0" }, { capabilities, ...(era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {}) });
  eras.set(client, era);
  return client;
};

/**
 * `client` (a plain 2025-11-25 one by default) connected to the server in
 * memory, as one stdio connection is: one client, requests both ways. A
 * client made for 2026-07-28 is served the way stdio serves it, by the SDK's
 * entry that picks the generation from the client's first message; `server`
 * may then be a function that builds one, since that entry may build a second.
 * For tests, which drive a server through the protocol without a process.
 */
export const connectInMemory = async (server: McpServer | (() => McpServer), client: Client = testClient("test")): Promise<Client> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const make = typeof server === "function" ? server : () => server;
  if (eras.get(client) === "modern") serveStdio(() => make(), { transport: serverSide });
  else await make().connect(serverSide);
  await client.connect(clientSide);
  return client;
};
