import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readlink, realpath, stat } from "node:fs/promises";
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
 * Every way a path can fail to lead to a regular file inside the folder (an
 * unsafe name, a missing file, a link out, a directory) is the same 404 with
 * the same words, so the answer says nothing about what the folder holds.
 */

/** What the server writes about each file it moves or refuses: never the bytes, and the path only for a file that moved. */
export type FilesLog = (line: string) => void;

export type FilesContext = {
  readonly files: FileEndpoints;
  /** The server's name and the caller's, for the log line. */
  readonly service: string;
  readonly client: string;
  readonly log: FilesLog;
  /** Answers with a plain-text message, as the rest of the server does. */
  readonly reply: (res: ServerResponse, status: number, message: string, headers?: Readonly<Record<string, string>>) => void;
};

const NOT_FOUND = "not found";

/** The file a handle really is: the kernel's own answer on Linux, the resolved name elsewhere. */
const openedPath = (handle: FileHandle, fallback: string): Promise<string> => readlink(`/proc/self/fd/${handle.fd}`).catch(() => realpath(fallback));

/**
 * The regular file at `names` below `root`, opened for reading, or undefined.
 * Links are resolved first and the result must lie inside the folder's real
 * path; the file actually opened is then read back from the kernel and held to
 * the same rule, so a link swapped in between the two is refused too.
 */
export const openInside = async (root: string, names: readonly string[]): Promise<{ readonly handle: FileHandle; readonly size: number } | undefined> => {
  const base = await realpath(root).catch(() => undefined);
  if (base === undefined) return undefined;
  const real = await realpath(join(base, ...names)).catch(() => undefined);
  if (real === undefined || real === base || !isInside(base, real)) return undefined;
  const handle = await open(real, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)).catch(() => undefined);
  if (handle === undefined) return undefined;
  const info = await handle.stat().catch(() => undefined);
  if (info === undefined || !info.isFile() || !isInside(base, await openedPath(handle, real))) {
    await handle.close();
    return undefined;
  }
  return { handle, size: info.size };
};

/**
 * The folder at `names` below `root`, made if it is missing, one name at a
 * time: each step that exists is resolved and must stay inside the folder's
 * real path, so a link planted in the inbox cannot lead a write out of it.
 * Undefined when a name is a file or leads out.
 */
export const folderInside = async (root: string, names: readonly string[]): Promise<string | undefined> => {
  await mkdir(root, { recursive: true, mode: 0o750 });
  const base = await realpath(root);
  let current = base;
  for (const name of names) {
    const next = join(current, name);
    await mkdir(next, { mode: 0o750 }).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== "EEXIST" && cause.code !== "ENOTDIR") throw cause;
    });
    const real = await realpath(next).catch(() => undefined);
    if (real === undefined || !isInside(base, real) || !(await stat(real)).isDirectory()) return undefined;
    current = real;
  }
  return current;
};

const outcomeLine = (context: FilesContext, line: Readonly<Record<string, unknown>>): void =>
  context.log(`files ${JSON.stringify({ svc: context.service, client: context.client, ...line })}`);

const sendFile = async (context: FilesContext, names: readonly string[], res: ServerResponse): Promise<void> => {
  const { files, reply } = context;
  const found = await openInside(files.outbox as string, names);
  if (found === undefined) {
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
 * sees why. Bounded in time; the request timeout bounds it too.
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

  const dir = await folderInside(inbox, names.slice(0, -1));
  const name = names.at(-1) as string;
  if (dir === undefined) return refuse(context, req, res, 404, NOT_FOUND, "not_found");
  const target = join(dir, name);
  if ((await lstat(target).catch(() => undefined))?.isDirectory()) return refuse(context, req, res, 409, "conflict", "conflict");

  const stored = await storeStream(req.iterator({ destroyOnReturn: false }), target, { maxBytes: files.maxBytes, ...(expected === undefined ? {} : { sha256: expected }) });
  if (!stored.ok) {
    if (stored.reason === "too_large") return refuse(context, req, res, 413, `file larger than ${files.maxBytes} bytes`, "too_large");
    if (stored.reason === "checksum_mismatch") return refuse(context, req, res, 422, "checksum mismatch", "checksum_mismatch");
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

/** Answers one file request, whatever goes wrong with a plain 500. */
export const serveFile = async (context: FilesContext, route: FileRoute, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const wanted = route.direction === "outbox" ? "GET" : "PUT";
  if (req.method !== wanted) return context.reply(res, 405, "method not allowed", { allow: wanted });
  const names = segmentsOf(route.rest);
  if (names === undefined) {
    outcomeLine(context, { direction: route.direction === "outbox" ? "download" : "upload", outcome: "not_found" });
    return context.reply(res, 404, NOT_FOUND);
  }
  try {
    await (route.direction === "outbox" ? sendFile(context, names, res) : receiveFile(context, names, req, res));
  } catch (error: unknown) {
    console.error(`${context.service}: file request failed:`, error);
    if (!res.headersSent) context.reply(res, 500, "internal error");
    else res.destroy();
  }
};
