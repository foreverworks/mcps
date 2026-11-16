import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { UpstreamTokenSource } from "./settings.js";

/**
 * The token the relay presents upstream for each of its clients, read once, at
 * start, and refused at start when a client would have none. A relay that
 * could not find a client's token and sent another's in its place would give
 * that client rights it was never given, so there is no fallback: every client
 * has a token of its own here, or the relay does not run.
 */
export type UpstreamTokens = {
  /** `one`: every client carries the same token (MCP_RELAY_UPSTREAM_TOKEN_FILE). `per-client`: each carries its own (MCP_RELAY_UPSTREAM_TOKENS_DIR). */
  readonly mode: "one" | "per-client";
  /** client name -> the token to present for it; the same value for every client in `one` mode. */
  readonly byClient: ReadonlyMap<string, string>;
};

/** The file of one client in MCP_RELAY_UPSTREAM_TOKENS_DIR. A different prefix than the kit's `token-`, so one folder can hold both and neither reads the other's files. */
export const UPSTREAM_PREFIX = "upstream-";

export const upstreamFileOf = (client: string): string => `${UPSTREAM_PREFIX}${client}`;

/** What is wrong with a token that has whitespace, a control character or a character outside printable ASCII in it, said after the name of its file. */
const INSIDE = "has whitespace or a control character inside the token, or a character outside printable ASCII, which no bearer token has; only the line end at the end of the file is dropped";

/** The longest name a file can have on the usual file systems. */
const MAX_FILE_NAME_BYTES = 255;

/**
 * What is wrong with one client's file: its name cannot be a file name, the
 * file is not there, holds nothing, has whitespace or a control character
 * inside the token, or cannot be read (and why, as Node's code for it).
 */
export type Problem = { readonly client: string; readonly what: "name" | "missing" | "empty" | "inside" | { readonly unreadable: string } };

const describeProblem = ({ client, what }: Problem): string => {
  const file = upstreamFileOf(client);
  if (what === "name") return `${JSON.stringify(client)} (not a name a file can have, so there can be no ${UPSTREAM_PREFIX}<client> file for it; a client name has no slash, backslash or NUL, and ${MAX_FILE_NAME_BYTES} bytes at most with the ${UPSTREAM_PREFIX} in front)`;
  if (what === "missing") return `${client} (${file} is missing)`;
  if (what === "empty") return `${client} (${file} is empty)`;
  if (what === "inside") return `${client} (${file} ${INSIDE})`;
  return `${client} (${file} cannot be read: ${what.unreadable})`;
};

/** The refusal to start when some clients have no usable token: names the clients and the files, never a token. */
export const refusalFor = (dir: string, problems: readonly Problem[]): string =>
  `MCP_RELAY_UPSTREAM_TOKENS_DIR ${dir} has no usable token for ${problems.length === 1 ? "a client" : "some clients"} of this relay: ${problems.map(describeProblem).join(", ")}. ` +
  `Every client the relay accepts needs a non-empty ${UPSTREAM_PREFIX}<client> file there, with the one token the server knows that client by, or its calls could not be sent upstream under its own name; ` +
  "a file for a client the relay does not have is ignored";

/** "alice", "alice and bob", "alice, bob and carol". */
const listOf = (names: readonly string[]): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) as string}`);

/** The refusal to start when clients would present the same token: names the clients, never the token. */
export const duplicateRefusalFor = (dir: string, groups: readonly (readonly string[])[]): string =>
  `MCP_RELAY_UPSTREAM_TOKENS_DIR ${dir} has the same token in the ${UPSTREAM_PREFIX}<client> files of ${groups.map(listOf).join("; another token is shared by ")}. ` +
  "The server could not tell those clients apart, and each would have the rights of the others: give each client a token of its own on the server (a token-<client> file there for each) " +
  `and put it in that client's ${UPSTREAM_PREFIX}<client> file; MCP_RELAY_UPSTREAM_TOKEN_FILE is the setting for clients that may share one token`;

/** The line a relay writes at start when every one of several clients reaches the server with the same token: they are one client to it, with one client's rights. Undefined when that is no news. */
export const sharedTokenWarning = ({ mode, byClient }: UpstreamTokens): string | undefined =>
  mode === "one" && byClient.size > 1
    ? `WARNING: MCP_RELAY_UPSTREAM_TOKEN_FILE gives every client of this relay (${[...byClient.keys()].join(", ")}) the same token upstream, so they all reach the server with the same rights and the server cannot tell them apart; ` +
      "to hold each to its own, use MCP_RELAY_UPSTREAM_TOKENS_DIR, with an upstream-<client> file for each"
    : undefined;

/** A client name that is a plain file name once `upstream-` is in front; the kit's own names are, but MCP_HTTP_TOKEN_CLIENT is free text, and `../x` must not reach out of the folder. */
const isFileName = (client: string): boolean => !/[/\\\0]/.test(client) && Buffer.byteLength(upstreamFileOf(client)) <= MAX_FILE_NAME_BYTES;

/**
 * Whether a token (its ends already trimmed) has anything but printable ASCII in it: whitespace, a
 * control character, or a character Node refuses in a header (a pasted zero-width space, a letter past
 * U+00FF). Every call would fail on it; refused at start instead, never a token.
 */
const hasInside = (token: string): boolean => /[^\x21-\x7e]/.test(token);

/** The trimmed contents of a token file, or why there are none. */
const readToken = async (path: string): Promise<{ readonly token: string } | { readonly missing: true } | { readonly unreadable: string }> => {
  try {
    return { token: (await readFile(path, "utf8")).trim() };
  } catch (thrown) {
    const code = (thrown as { code?: unknown } | null)?.code;
    return code === "ENOENT" ? { missing: true } : { unreadable: typeof code === "string" ? code : "an error" };
  }
};

/** One client's file: the token in it, or what is wrong with it. */
type Found = { readonly client: string; readonly token: string } | Problem;

const findToken = async (dir: string, client: string): Promise<Found> => {
  if (!isFileName(client)) return { client, what: "name" };
  const read = await readToken(join(dir, upstreamFileOf(client)));
  if ("missing" in read) return { client, what: "missing" };
  if ("unreadable" in read) return { client, what: { unreadable: read.unreadable } };
  if (read.token === "") return { client, what: "empty" };
  return hasInside(read.token) ? { client, what: "inside" } : { client, token: read.token };
};

/**
 * The tokens for these clients, which are the ones the relay accepts (those of
 * `loadTokens`, whose files are not blank). In `dir` mode a client whose name
 * cannot be a file name, or whose `upstream-<client>` file is missing, blank,
 * unreadable or has whitespace inside the token, is a refusal that names every
 * such client at once; so is a token two clients share, which the server could
 * not tell them apart by. Files for other clients are not read. In `file` mode
 * there is one token for all, and a file with nothing in it, or whitespace
 * inside the token, is a refusal.
 */
export const loadUpstreamTokens = async (source: UpstreamTokenSource, clients: readonly string[]): Promise<UpstreamTokens> => {
  if (source.kind === "file") {
    const token = (await readFile(source.file, "utf8")).trim();
    if (token === "") throw new Error(`${source.file} (MCP_RELAY_UPSTREAM_TOKEN_FILE) is empty`);
    if (hasInside(token)) throw new Error(`${source.file} (MCP_RELAY_UPSTREAM_TOKEN_FILE) ${INSIDE}`);
    return { mode: "one", byClient: new Map(clients.map((client) => [client, token])) };
  }
  const found = await Promise.all(clients.map((client) => findToken(source.dir, client)));
  const problems = found.filter((one): one is Problem => "what" in one);
  if (problems.length > 0) throw new Error(refusalFor(source.dir, problems));
  const tokens = found.flatMap((one) => ("token" in one ? [[one.client, one.token] as const] : []));
  const clientsOf = new Map<string, string[]>();
  for (const [client, token] of tokens) clientsOf.set(token, [...(clientsOf.get(token) ?? []), client]);
  const shared = [...clientsOf.values()].filter((group) => group.length > 1);
  if (shared.length > 0) throw new Error(duplicateRefusalFor(source.dir, shared));
  return { mode: "per-client", byClient: new Map(tokens) };
};
