import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isInside } from "@foreverworks/mcp-kit";

/**
 * What the relay reads of the JSON-RPC messages it passes: which are tool
 * calls, which strings in their arguments name files in the inbox, and which
 * content items of a result link files in the outbox. Pure: the file system
 * and the network are the modules that call these.
 */

export type JsonRpcId = string | number;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** A request body as the messages it holds: one, or the members of a batch. */
export const messagesOf = (body: unknown): readonly unknown[] => (Array.isArray(body) ? body : [body]);

/** A `tools/call` request: the ones that carry a file by path, and that can be answered by id. */
export const toolCallArguments = (message: unknown): { readonly id: JsonRpcId; readonly arguments: unknown } | undefined => {
  if (!isObject(message) || message["method"] !== "tools/call") return undefined;
  const id = message["id"];
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const params = message["params"];
  return { id, arguments: isObject(params) ? params["arguments"] : undefined };
};

/** The longest string worth looking at: no path on the machines this runs on is longer. */
const LONGEST_PATH = 4096;
const DEEPEST = 64;

/** Every string anywhere in a value (a list's members, an object's values, not its keys), nested no deeper than a sane argument is. */
export const stringsIn = (value: unknown, depth = 0): readonly string[] => {
  if (typeof value === "string") return value.length > 0 && value.length <= LONGEST_PATH ? [value] : [];
  if (depth >= DEEPEST) return [];
  if (Array.isArray(value)) return value.flatMap((member) => stringsIn(member, depth + 1));
  if (isObject(value)) return Object.values(value).flatMap((member) => stringsIn(member, depth + 1));
  return [];
};

/**
 * The paths among a call's arguments that the inbox could hold: the strings
 * that are absolute paths below `inbox` once `.` and `..` are resolved,
 * each once. Whether such a path names a file is for the file system to say.
 */
export const inboxPathsIn = (args: unknown, inbox: string): readonly string[] => {
  const found = new Set<string>();
  for (const text of stringsIn(args)) {
    if (!isAbsolute(text) || text.includes("\0")) continue;
    const path = resolve(text);
    if (path !== inbox && isInside(inbox, path)) found.add(path);
  }
  return [...found];
};

/** A path below a folder, as the `/`-separated names the file endpoints take. */
export const namesBelow = (root: string, path: string): readonly string[] => path.slice(root.length).split("/").filter((name) => name !== "");

/**
 * The local path a `resource_link` URI names, if it is a `file:` URI for this
 * machine that points below `outbox` once `.` and `..` are resolved; undefined
 * for every other link, which the relay leaves alone.
 */
export const outboxPathOf = (uri: string, outbox: string): string | undefined => {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return undefined;
    const path = resolve(fileURLToPath(url));
    return path !== outbox && isInside(outbox, path) ? path : undefined;
  } catch {
    return undefined;
  }
};

/** The response to `id` that says the call was not made, and why. */
export const failedCall = (id: JsonRpcId, message: string): Json => ({ jsonrpc: "2.0", id, error: { code: -32000, message } });

/** A tool result's content, if this message is a response that has any. */
const contentOf = (message: unknown): unknown[] | undefined => {
  if (!isObject(message)) return undefined;
  const result = message["result"];
  const content = isObject(result) ? result["content"] : undefined;
  return Array.isArray(content) ? content : undefined;
};

/** The `uri` of every `resource_link` among a response's content items. */
export const linkUris = (message: unknown): readonly string[] =>
  (contentOf(message) ?? []).flatMap((item) => (isObject(item) && item["type"] === "resource_link" && typeof item["uri"] === "string" ? [item["uri"]] : []));

/** The response with one text item added at the end of its content; any other message unchanged. */
export const withNote = (message: unknown, text: string): unknown => {
  const content = contentOf(message);
  if (content === undefined || !isObject(message)) return message;
  return { ...message, result: { ...(message["result"] as Json), content: [...content, { type: "text", text }] } };
};
