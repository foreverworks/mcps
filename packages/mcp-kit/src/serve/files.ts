import { isAbsolute, resolve } from "node:path";

/**
 * File endpoints for a server that runs on another machine than its clients
 * (MCP_HTTP_FILES_OUTBOX, MCP_HTTP_FILES_INBOX; docs/configuration.md, "Files
 * to and from another machine"). Off unless a variable is set, and then only
 * the direction it names: with none, these routes do not exist and answer as
 * any unknown route does. A client held to a ceiling (MCP_CLIENT_MAX_ACCESS)
 * is refused both with a 403, but for a GET of a file one of its own calls
 * handed back (serve/ownFiles.ts): the ceiling checks tool calls, and a file
 * moves outside them, so the endpoints belong to clients with none, and a
 * held client gets only what a call within its ceiling made for it.
 *
 * This file is the pure half: the settings, which request is a file request,
 * and the one rule for turning a URL into a path inside a folder. The streams
 * and the file system are serve/filesServe.ts.
 */

/** A server's outbox, read through `GET <this>/<path>`: what its tools hand back. */
export const FILES_OUTBOX_PATH = "/files/outbox";

/** A server's inbox, written through `PUT <this>/<path>`: what its tools take by path. */
export const FILES_INBOX_PATH = "/files/inbox";

/** Carries a file's hex SHA-256: on a GET's answer, and on a PUT whose bytes must match it. */
export const SHA256_HEADER = "x-content-sha256";

/** The largest file the inbox takes unless MCP_HTTP_FILES_MAX_BYTES says otherwise. */
export const DEFAULT_FILES_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Which directions are on, and the folders they serve. A key is absent when
 * its variable is unset.
 */
export type FileEndpoints = {
  /** An absolute folder: `GET /files/outbox/<path>` reads files below it. */
  readonly outbox?: string;
  /** An absolute folder: `PUT /files/inbox/<path>` writes files below it. */
  readonly inbox?: string;
  /** The most bytes a PUT may carry. */
  readonly maxBytes: number;
  /** Whole minutes after which a file in either folder is deleted (serve/filesSweep.ts). The key is absent when MCP_HTTP_FILES_MAX_AGE_MIN is unset: files are kept. */
  readonly maxAgeMin?: number;
};

/**
 * A folder named by a variable, as an absolute path; undefined when the
 * variable is unset or blank. A relay maps a file to the same path on both
 * machines, so a folder written relative to nothing is a mistake worth
 * stopping for.
 */
export const folderFrom = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (!isAbsolute(value)) {
    throw new Error(`${name} "${value}" is not an absolute path: a relay maps a file to the same path on both machines, so the folder must be written in full`);
  }
  return resolve(value);
};

/** The names that switch the endpoints on, or configure them; each one needs MCP_HTTP_PORT and tokens. */
export const FILES_VARIABLES = ["MCP_HTTP_FILES_OUTBOX", "MCP_HTTP_FILES_INBOX", "MCP_HTTP_FILES_MAX_BYTES", "MCP_HTTP_FILES_MAX_AGE_MIN"] as const;

/**
 * MCP_HTTP_FILES_OUTBOX and MCP_HTTP_FILES_INBOX, each a folder that switches
 * its direction on, MCP_HTTP_FILES_MAX_BYTES for the inbox, and
 * MCP_HTTP_FILES_MAX_AGE_MIN for how long a file stays in either. Undefined
 * when neither folder is set. A size without an inbox to cap, or an age
 * without a folder to clear, is a mistake worth stopping for, like a bind
 * address without the hosts.
 *
 * A plain throw, not a tagged failure: this is a process that must not start.
 */
export const filesFrom = (env: NodeJS.ProcessEnv): FileEndpoints | undefined => {
  const outbox = folderFrom(env, "MCP_HTTP_FILES_OUTBOX");
  const inbox = folderFrom(env, "MCP_HTTP_FILES_INBOX");
  const max = env["MCP_HTTP_FILES_MAX_BYTES"]?.trim();
  if (inbox === undefined && max) throw new Error("MCP_HTTP_FILES_MAX_BYTES is set without MCP_HTTP_FILES_INBOX: only a file put into the inbox has a size limit");
  const age = env["MCP_HTTP_FILES_MAX_AGE_MIN"]?.trim();
  if (outbox === undefined && inbox === undefined) {
    if (age) throw new Error("MCP_HTTP_FILES_MAX_AGE_MIN is set without MCP_HTTP_FILES_INBOX or MCP_HTTP_FILES_OUTBOX: there is no folder whose files it could delete");
    return undefined;
  }
  const maxBytes = max ? Number(max) : DEFAULT_FILES_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error(`MCP_HTTP_FILES_MAX_BYTES "${max}" is not a number of bytes`);
  const maxAgeMin = age ? Number(age) : undefined;
  if (age && (!/^\d+$/.test(age) || !Number.isSafeInteger(maxAgeMin) || maxAgeMin === 0)) {
    throw new Error(`MCP_HTTP_FILES_MAX_AGE_MIN "${age}" is not a number of minutes: write a whole number above zero, or leave it unset to keep files`);
  }
  return {
    ...(outbox === undefined ? {} : { outbox }),
    ...(inbox === undefined ? {} : { inbox }),
    maxBytes,
    ...(maxAgeMin === undefined ? {} : { maxAgeMin }),
  };
};

/**
 * How often files older than `maxAgeMin` are looked for: a quarter of the age,
 * so a file is gone within a quarter again of its age at most, but never
 * oftener than a minute (a sweep reads the whole folder) nor rarer than an hour.
 */
export const sweepIntervalMs = (maxAgeMin: number): number => Math.min(60, Math.max(1, maxAgeMin / 4)) * 60_000;

/** Which folder a file request is for, and what follows the route in the request's target, still percent-encoded. */
export type FileRoute = { readonly direction: "outbox" | "inbox"; readonly rest: string };

/**
 * The file route a request target belongs to, if that direction is on. The
 * TARGET as the client wrote it (`req.url`), not a parsed URL: a URL parser
 * resolves `..` and `%2e%2e` itself, and the path rule below must see them.
 * Undefined for everything else, which the server then treats as it always
 * has.
 */
export const fileRouteOf = (target: string | undefined, files: FileEndpoints): FileRoute | undefined => {
  if (target === undefined || !target.startsWith("/")) return undefined;
  const path = target.split(/[?#]/, 1)[0] as string;
  for (const [direction, prefix] of [
    ["outbox", FILES_OUTBOX_PATH],
    ["inbox", FILES_INBOX_PATH],
  ] as const) {
    if (files[direction] === undefined) continue;
    if (path === prefix) return { direction, rest: "" };
    if (path.startsWith(`${prefix}/`)) return { direction, rest: path.slice(prefix.length + 1) };
  }
  return undefined;
};

/**
 * What a client held to a ceiling (MCP_CLIENT_MAX_ACCESS) is told when it asks
 * for anything but a file one of its own calls handed back: the ceiling checks
 * tool calls, and a file crosses outside them, so these endpoints are for
 * clients with none. Says nothing of the folders, and covers every reason
 * alike (an upload, another client's file, a record forgotten).
 */
export const FILES_REFUSED_FOR_CEILING =
  "this file is not available to this client: its calls are limited by a ceiling (MCP_CLIENT_MAX_ACCESS), and files cross outside the tool calls that ceiling checks, so it may only fetch a file one of its own calls handed back, while the server still remembers that call (a restart forgets it, and so does the outbox's retention: call the tool again); uploads, and every other file, are for clients with no ceiling";

/** The longest name a file system takes (ext4, xfs, zfs and the rest of what servers run on). */
const MAX_NAME_BYTES = 255;

/**
 * The names a file route's path is made of, or undefined when it is not a
 * path the endpoints take. Each segment is percent-decoded once, then must be
 * a plain name: not empty (so no `//`, no leading or trailing `/`, nothing
 * absolute), not `.` or `..`, and holding no NUL, backslash or `/` (a `%2F`
 * does not smuggle in a separator), and not longer than a file system's names. Nothing is said about WHY a path was
 * refused: a client learns nothing about the folder from the answer.
 */
export const segmentsOf = (rest: string): readonly string[] | undefined => {
  if (rest === "") return undefined;
  const names: string[] = [];
  for (const piece of rest.split("/")) {
    let name: string;
    try {
      name = decodeURIComponent(piece);
    } catch {
      return undefined;
    }
    if (name === "" || name === "." || name === ".." || /[\0\\/]/.test(name) || Buffer.byteLength(name) > MAX_NAME_BYTES) return undefined;
    names.push(name);
  }
  return names;
};

/** A path below a folder as the URL path of a file route: each name escaped as a URL needs, the inverse of `segmentsOf`. */
export const filesUrlPath = (route: typeof FILES_OUTBOX_PATH | typeof FILES_INBOX_PATH, relative: string): string =>
  `${route}/${relative.split("/").map(encodeURIComponent).join("/")}`;

/** The startup line's words for the endpoints that are on. */
export const describeFiles = (files: FileEndpoints): string =>
  [
    files.outbox === undefined ? undefined : `GET ${FILES_OUTBOX_PATH}/ reads ${files.outbox}`,
    files.inbox === undefined ? undefined : `PUT ${FILES_INBOX_PATH}/ writes ${files.inbox} (up to ${files.maxBytes} bytes)`,
    files.maxAgeMin === undefined ? undefined : `files older than ${files.maxAgeMin} min are deleted`,
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");
