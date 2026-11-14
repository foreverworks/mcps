import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { FILES_INBOX_PATH, FILES_OUTBOX_PATH, filesUrlPath, folderInside, openFileInside, parseSha256, SHA256_HEADER, sha256OfHandle, storeStream } from "@foreverworks/mcp-kit";

import { linkUris, namesBelow, outboxPathOf, withNote } from "./calls.js";
import { type Answer, readAnswer, reasonOf, send, snippetOf, statusWords, type Upstream } from "./upstream.js";

/**
 * The two ways a file crosses: up to the server's inbox before a call that
 * names it, and down from the server's outbox after a call that handed it
 * back. The paths are the same on both machines (docs: the relay's README),
 * so a file's path is its identity and nothing in a call needs rewriting.
 *
 * Nothing here logs or returns a file's bytes, a token or an argument's value;
 * a moved file leaves one line with its direction, path, size and the start of
 * its SHA-256, and a failure is a sentence that names the path and the reason.
 */
export type Transfer = {
  readonly upstream: Upstream;
  readonly inbox?: string | undefined;
  readonly outbox?: string | undefined;
  readonly maxFileBytes: number;
  readonly log: (line: string) => void;
};

/** A file moved, or why not (as a sentence that goes after the path). */
export type Moved = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const failed = (reason: string): Moved => ({ ok: false, reason });

const movedLine = (transfer: Transfer, direction: "upload" | "download", path: string, size: number, sha256: string): void =>
  transfer.log(`relay-file ${JSON.stringify({ direction, path, size, sha256: sha256.slice(0, 12) })}`);

/** An answer's body is not wanted: let the connection go. */
const discard = (answer: Answer): void => {
  answer.body.destroy();
};

const attempt = async (transfer: Transfer, run: () => Promise<Answer>): Promise<Answer | string> => {
  try {
    return await run();
  } catch (thrown) {
    return `the upstream could not be reached (${reasonOf(thrown, transfer.upstream)})`;
  }
};

/**
 * A file the relay's inbox holds, sent to the same path in the server's. A
 * path that is not a regular file inside the inbox (a name the client made
 * up, a link to somewhere else) is not sent and not an error: the call goes
 * on, and the server's tool says what it finds. Streamed from the open file,
 * hashed first, so a large file is never held whole.
 */
export const uploadFile = async (transfer: Transfer, path: string, signal: AbortSignal): Promise<Moved> => {
  const { inbox, upstream } = transfer;
  if (inbox === undefined) return { ok: true };
  const names = namesBelow(inbox, path);
  const opened = await openFileInside(inbox, names).catch(() => undefined);
  if (opened === undefined) return { ok: true };
  const { handle, size } = opened;
  try {
    if (size > transfer.maxFileBytes) return failed(`it is ${size} bytes, over the relay's limit of ${transfer.maxFileBytes} bytes (MCP_RELAY_MAX_FILE_BYTES)`);
    const sha256 = await sha256OfHandle(handle, size);
    const answer = await attempt(transfer, () =>
      send(upstream, {
        method: "PUT",
        path: filesUrlPath(FILES_INBOX_PATH, names.join("/")),
        headers: { "content-type": "application/octet-stream", "content-length": String(size), [SHA256_HEADER]: sha256 },
        body: size === 0 ? Buffer.alloc(0) : handle.createReadStream({ start: 0, end: size - 1, autoClose: false }),
        signal,
      }),
    );
    if (typeof answer === "string") return failed(answer);
    if (answer.status !== 200) {
      discard(answer);
      return failed(statusWords(answer.status));
    }
    const text = await readAnswer(answer, 64 * 1024);
    const stored = parseStored(text);
    if (stored === undefined) return failed("the upstream's answer to the upload was not what its file endpoint sends");
    if (stored.size !== size || stored.sha256 !== sha256) return failed("the upstream stored other bytes than were sent");
    if (stored.path !== path) {
      // The server's tools will look for the file where THEY keep their inbox. Say so once per file, loudly, and let the call go on.
      transfer.log(`relay-warning ${JSON.stringify({ message: "the upstream stored a file elsewhere than the path the call names; MCP_RELAY_INBOX must be the folder the server's tools read, at the same path", sent: path, stored: stored.path })}`);
    }
    movedLine(transfer, "upload", path, size, sha256);
    return { ok: true };
  } finally {
    await handle.close();
  }
};

const parseStored = (body: Buffer | undefined): { readonly path: string; readonly size: number; readonly sha256: string } | undefined => {
  if (body === undefined) return undefined;
  try {
    const value = JSON.parse(body.toString("utf8")) as { path?: unknown; size?: unknown; sha256?: unknown };
    return typeof value.path === "string" && typeof value.size === "number" && typeof value.sha256 === "string" ? { path: value.path, size: value.size, sha256: value.sha256 } : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A file in the server's outbox, brought to the same path in the relay's,
 * whole or not at all, checked against the SHA-256 the server sent with it.
 * The folders on the way are made one name at a time and each must stay inside
 * the outbox, so a link in it cannot lead the write out.
 */
export const downloadFile = async (transfer: Transfer, path: string, signal: AbortSignal): Promise<Moved> => {
  const { outbox, upstream } = transfer;
  if (outbox === undefined) return failed("the relay has no outbox (MCP_RELAY_OUTBOX is not set)");
  const names = namesBelow(outbox, path);
  const answer = await attempt(transfer, () => send(upstream, { method: "GET", path: filesUrlPath(FILES_OUTBOX_PATH, names.join("/")), signal }));
  if (typeof answer === "string") return failed(answer);
  if (answer.status !== 200) {
    const note = await readAnswer(answer, 512);
    return failed(`${statusWords(answer.status)}${note === undefined || note.length === 0 ? "" : ` (${snippetOf(note, upstream)})`}`);
  }
  const expected = parseSha256(String(answer.headers[SHA256_HEADER] ?? ""));
  if (expected === undefined) {
    discard(answer);
    return failed("the upstream sent the file without its checksum");
  }
  if (Number(answer.headers["content-length"] ?? "0") > transfer.maxFileBytes) {
    discard(answer);
    return failed(`it is larger than the relay's limit of ${transfer.maxFileBytes} bytes (MCP_RELAY_MAX_FILE_BYTES)`);
  }
  try {
    const dir = await folderInside(outbox, names.slice(0, -1));
    if (dir === undefined) {
      discard(answer);
      return failed("it leads out of MCP_RELAY_OUTBOX, or through a file, on this machine");
    }
    const target = join(dir, names.at(-1) as string);
    if ((await lstat(target).catch(() => undefined))?.isDirectory()) {
      discard(answer);
      return failed("a folder is where it should go on this machine");
    }
    const stored = await storeStream(answer.body, target, { maxBytes: transfer.maxFileBytes, sha256: expected });
    if (!stored.ok) {
      discard(answer);
      if (stored.reason === "too_large") return failed(`it is larger than the relay's limit of ${transfer.maxFileBytes} bytes (MCP_RELAY_MAX_FILE_BYTES)`);
      if (stored.reason === "checksum_mismatch") return failed("it arrived damaged: its SHA-256 is not the one the upstream sent with it, so nothing was kept");
      return failed("the transfer broke off, so nothing was kept");
    }
    movedLine(transfer, "download", path, stored.size, stored.sha256);
    return { ok: true };
  } catch (thrown) {
    discard(answer);
    return failed(`it could not be written on this machine (${reasonOf(thrown, upstream)})`);
  }
};

/**
 * A response with the files it links brought over. Every `resource_link` to a
 * `file:` path below the outbox is fetched, once, before the response is
 * passed on; one that cannot be gets a line in a single text item added to the
 * result, so the client reads that the link does not lead to a file here. Links
 * to anywhere else, and every other message, come back as they were.
 */
export const mirrorLinks = async (transfer: Transfer, message: unknown, signal: AbortSignal): Promise<unknown> => {
  const { outbox } = transfer;
  if (outbox === undefined) return message;
  const paths = [...new Set(linkUris(message).flatMap((uri) => outboxPathOf(uri, outbox) ?? []))];
  const notes: string[] = [];
  for (const path of paths) {
    const moved = await downloadFile(transfer, path, signal);
    if (!moved.ok) notes.push(`${path}: ${moved.reason}`);
  }
  if (notes.length === 0) return message;
  return withNote(message, `The relay could not bring ${notes.length === 1 ? "a file" : "some files"} the server saved to this machine, so ${notes.length === 1 ? "its link does" : "their links do"} not lead to a file here:\n${notes.join("\n")}`);
};
