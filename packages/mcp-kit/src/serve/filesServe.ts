import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readlink, realpath, rmdir, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { sha256OfHandle, storeStream } from "../fileStream.js";
import { isInside } from "../inputFile/roots.js";
import { parseSha256 } from "../inputFile/bytes.js";
import { mimeTypeOf } from "../outbox.js";
import { type FileEndpoints, type FileRoute, segmentsOf, SHA256_HEADER } from "./files.js";

/**
 * The file endpoints' answers (serve/files.ts): `GET /files/outbox/<path>`
 * streams a file out of the outbox folder with its length, type and SHA-256;
 * `PUT /files/inbox/<path>` writes one into the inbox folder, whole or not at
 * all. The caller has already authenticated the request, checked its Host and
 * counted it against the client's rate; this decides only what the request
 * means for the folders.
 *
 * Every way a PATH can fail to lead to a regular file inside the folder (an
 * unsafe name, a missing file, a link out, a directory, a file unreadable to
 * the server) is the same 404 with the same words, so the answer says nothing
 * about what the folder holds. What else an upload can be told is about the
 * request, not the folder: 400 (a malformed X-Content-SHA256), 405 (the other
 * method), 409 (a folder is where the file would go), 413 (over the size cap),
 * 422 (the bytes are not the ones hashed), 429 (the rate limit, from the
 * caller) and a plain 500.
 */

/** What the server writes about each file it moves or refuses: never the bytes, and the path only for a file that moved. */
export type FilesLog = (line: string) => void;

export type FilesContext = {
  readonly files: FileEndpoints;
  /** The server's name and the caller's, for the log line. */
  readonly service: string;
  readonly client: string;
  readonly log: FilesLog;
  /** The longest an upload may take in all (MCP_HTTP_TIMEOUT_MS); it also may not go quiet for longer than a minute. */
  readonly timeoutMs: number;
  /** Answers with a plain-text message, as the rest of the server does. */
  readonly reply: (res: ServerResponse, status: number, message: string, headers?: Readonly<Record<string, string>>) => void;
};

const NOT_FOUND = "not found";

/** The file a handle really is: the kernel's own answer on Linux, the resolved name elsewhere. */
const openedPath = (handle: FileHandle, fallback: string): Promise<string> => readlink(`/proc/self/fd/${handle.fd}`).catch(() => realpath(fallback));

/** What opening a file for reading came to: the file, or why not (what is silent to a client and what a relay must say). */
export type Opened =
  | { readonly ok: true; readonly handle: FileHandle; readonly size: number }
  /** No such file, or the path leads nowhere (a link loop, a name below a file). */
  | { readonly ok: false; readonly reason: "missing" }
  /** The path leads out of the folder, through a link or otherwise. */
  | { readonly ok: false; readonly reason: "outside" }
  | { readonly ok: false; readonly reason: "not_a_file" }
  /** It is there and is not for this process to read (permissions, a failing disk). `code` is the system's. */
  | { readonly ok: false; readonly reason: "unreadable"; readonly code: string };

const MISSING = new Set(["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"]);

const tried = async <T>(run: () => Promise<T>): Promise<{ readonly value: T } | { readonly code: string }> => {
  try {
    return { value: await run() };
  } catch (cause) {
    return { code: (cause as NodeJS.ErrnoException).code ?? "error" };
  }
};

const failedWith = (code: string): Opened => (MISSING.has(code) ? { ok: false, reason: "missing" } : { ok: false, reason: "unreadable", code });

/**
 * The regular file at `names` below `root`, opened for reading, or why not.
 * Links are resolved first and the result must lie inside the folder's real
 * path; the file actually opened is then read back from the kernel and held to
 * the same rule, so a link swapped in between the two is refused too.
 */
export const openInside = async (root: string, names: readonly string[]): Promise<Opened> => {
  const base = await tried(() => realpath(root));
  if ("code" in base) return failedWith(base.code);
  const real = await tried(() => realpath(join(base.value, ...names)));
  if ("code" in real) return failedWith(real.code);
  if (real.value === base.value || !isInside(base.value, real.value)) return { ok: false, reason: "outside" };
  const opened = await tried(() => open(real.value, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)));
  if ("code" in opened) return opened.code === "ELOOP" ? { ok: false, reason: "outside" } : failedWith(opened.code);
  const handle = opened.value;
  const info = await tried(() => handle.stat());
  if ("code" in info) {
    await handle.close();
    return failedWith(info.code);
  }
  if (!info.value.isFile() || !isInside(base.value, await openedPath(handle, real.value))) {
    await handle.close();
    return { ok: false, reason: info.value.isFile() ? "outside" : "not_a_file" };
  }
  return { ok: true, handle, size: info.value.size };
};

/** A folder made for an upload, and the ones made on the way to it, to be removed if the upload comes to nothing. */
export type Folder = {
  /** The real path of the folder the file goes in. */
  readonly dir: string;
  /** The real path of the root it lies in. */
  readonly base: string;
  /** The folders this call made, outermost first. */
  readonly created: readonly string[];
};

/** Takes away the folders a call made, innermost first, as far as they are empty: another upload may have put a file in one. */
export const removeFolders = async (created: readonly string[]): Promise<void> => {
  for (const dir of [...created].reverse()) await rmdir(dir).catch(() => undefined);
};

/**
 * The folder at `names` below `root`, made if it is missing, one name at a
 * time: each step that exists is resolved and must stay inside the folder's
 * real path, so a link planted in the inbox cannot lead a write out of it.
 * Undefined when a name is a file or leads out (and then nothing is left made).
 */
export const folderInside = async (root: string, names: readonly string[]): Promise<Folder | undefined> => {
  await mkdir(root, { recursive: true, mode: 0o750 });
  const base = await realpath(root);
  const created: string[] = [];
  let current = base;
  try {
    for (const name of names) {
      const next = join(current, name);
      const made = await mkdir(next, { mode: 0o750 }).then(
        () => true,
        (cause: NodeJS.ErrnoException) => {
          if (cause.code !== "EEXIST" && cause.code !== "ENOTDIR") throw cause;
          return false;
        },
      );
      if (made) created.push(next);
      const real = await realpath(next).catch(() => undefined);
      if (real === undefined || !isInside(base, real) || !(await stat(real)).isDirectory()) {
        await removeFolders(created);
        return undefined;
      }
      current = real;
    }
  } catch (cause) {
    await removeFolders(created);
    throw cause;
  }
  return { dir: current, base, created };
};

const outcomeLine = (context: FilesContext, line: Readonly<Record<string, unknown>>): void =>
  context.log(`files ${JSON.stringify({ svc: context.service, client: context.client, ...line })}`);

const sendFile = async (context: FilesContext, names: readonly string[], res: ServerResponse): Promise<void> => {
  const { files, reply } = context;
  const found = await openInside(files.outbox as string, names);
  if (!found.ok) {
    outcomeLine(context, { direction: "download", outcome: "not_found" });
    return reply(res, 404, NOT_FOUND);
  }
  const { handle, size } = found;
  try {
    const sha256 = await sha256OfHandle(handle, size);
    res.writeHead(200, {
      "content-type": mimeTypeOf(names.at(-1) as string) ?? "application/octet-stream",
      "content-length": String(size),
      [SHA256_HEADER]: sha256,
    });
    if (size === 0) res.end();
    else await pipeline(handle.createReadStream({ start: 0, end: size - 1, autoClose: false }), res);
    outcomeLine(context, { direction: "download", outcome: "ok", path: names.join("/"), size, sha256: sha256.slice(0, 12) });
  } catch {
    // The client hung up, or the file shrank under the stream: an answer already on its way cannot be taken back.
    outcomeLine(context, { direction: "download", outcome: "interrupted" });
    if (res.headersSent) res.destroy();
    else reply(res, 500, "internal error");
  } finally {
    await handle.close();
  }
};

/**
 * What is left of a body the server will not store, read and thrown away so
 * the client can finish sending and then read the answer: a server that hangs
 * up on a sender still writing resets the connection, and the sender never
 * sees why. Bounded in time (here, and by the upload's own limits).
 */
const drain = (req: IncomingMessage): void => {
  if (req.readableEnded || req.destroyed) return;
  req.resume();
  const timer = setTimeout(() => req.destroy(), 30_000);
  req.once("close", () => clearTimeout(timer));
};

/** A refusal of a body that may still be on its way. */
const refuse = (context: FilesContext, req: IncomingMessage, res: ServerResponse, status: number, message: string, outcome: string): void => {
  outcomeLine(context, { direction: "upload", outcome });
  context.reply(res, status, message);
  drain(req);
};

const receiveFile = async (context: FilesContext, names: readonly string[], req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const { files } = context;
  const inbox = files.inbox as string;
  const header = req.headers[SHA256_HEADER];
  const expected = typeof header === "string" ? parseSha256(header) : undefined;
  if (header !== undefined && expected === undefined) return refuse(context, req, res, 400, `${SHA256_HEADER} must be 64 hex characters`, "bad_request");
  if (Number(req.headers["content-length"] ?? "0") > files.maxBytes) return refuse(context, req, res, 413, `file larger than ${files.maxBytes} bytes`, "too_large");

  const folder = await folderInside(inbox, names.slice(0, -1));
  if (folder === undefined) return refuse(context, req, res, 404, NOT_FOUND, "not_found");
  // An upload that comes to nothing takes the folders it made with it.
  const undone = async (status: number, message: string, outcome: string): Promise<void> => {
    await removeFolders(folder.created);
    refuse(context, req, res, status, message, outcome);
  };
  const target = join(folder.dir, names.at(-1) as string);
  if ((await lstat(target).catch(() => undefined))?.isDirectory()) return undone(409, "conflict", "conflict");

  const stored = await storeStream(req.iterator({ destroyOnReturn: false }), target, {
    maxBytes: files.maxBytes,
    within: folder.base,
    ...(expected === undefined ? {} : { sha256: expected }),
  });
  if (!stored.ok) {
    if (stored.reason === "too_large") return undone(413, `file larger than ${files.maxBytes} bytes`, "too_large");
    if (stored.reason === "checksum_mismatch") return undone(422, "checksum mismatch", "checksum_mismatch");
    if (stored.reason === "outside") return undone(404, NOT_FOUND, "not_found");
    await removeFolders(folder.created);
    outcomeLine(context, { direction: "upload", outcome: "interrupted" });
    // A client that hung up has nobody to tell; a disk that refused the bytes does.
    if (req.errored !== null || req.destroyed) res.destroy();
    else {
      context.reply(res, 500, "internal error");
      drain(req);
    }
    return;
  }
  // The path as the server's tools will name it: below the folder as configured, not as the disk resolved it.
  const path = join(inbox, ...names);
  outcomeLine(context, { direction: "upload", outcome: "ok", path: names.join("/"), size: stored.size, sha256: stored.sha256.slice(0, 12) });
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(`${JSON.stringify({ path, size: stored.size, sha256: stored.sha256 })}\n`);
};

/** How long an upload may go without a byte before the connection is dropped. */
const UPLOAD_IDLE_MS = 60_000;

/**
 * An upload's own limits: it may not go quiet for a minute (or less, when
 * MCP_HTTP_TIMEOUT_MS is less), and may not take longer than a call may. With
 * an inbox on, the HTTP server's request timeout is off (serve.ts) because it
 * would cut a large file short, and these are what bound a request that has
 * signed in. Returns what lifts the total limit.
 */
const boundUpload = (context: FilesContext, req: IncomingMessage): (() => void) => {
  req.socket.setTimeout(Math.min(UPLOAD_IDLE_MS, context.timeoutMs));
  const timer = setTimeout(() => req.destroy(), context.timeoutMs);
  return () => clearTimeout(timer);
};

/** Answers one file request, whatever goes wrong with a plain 500. */
export const serveFile = async (context: FilesContext, route: FileRoute, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const lift = route.direction === "inbox" ? boundUpload(context, req) : () => undefined;
  try {
    const wanted = route.direction === "outbox" ? "GET" : "PUT";
    if (req.method !== wanted) return context.reply(res, 405, "method not allowed", { allow: wanted });
    const names = segmentsOf(route.rest);
    if (names === undefined) {
      outcomeLine(context, { direction: route.direction === "outbox" ? "download" : "upload", outcome: "not_found" });
      return context.reply(res, 404, NOT_FOUND);
    }
    await (route.direction === "outbox" ? sendFile(context, names, res) : receiveFile(context, names, req, res));
  } catch (error: unknown) {
    console.error(`${context.service}: file request failed:`, error);
    if (!res.headersSent) context.reply(res, 500, "internal error");
    else res.destroy();
  } finally {
    lift();
  }
};
