import { constants } from "node:fs";
import { type FileHandle, open, readlink, realpath } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import { decodeBase64Strict, parseSha256, sha256Of } from "./inputFile/bytes.js";
import { clientRoots } from "./clientRoots.js";
import { clientRootsApply, fileRootsFrom, insideAny } from "./inputFile/roots.js";
import { failInputFile, type InputFileCode } from "./inputFileErrors.js";

/**
 * A file a tool takes as INPUT, byte-exact.
 *
 * A tool call's arguments are written by the model, so a file sent as base64
 * is a file retyped, and a retyped file can come out one character wrong with
 * nothing noticing; one wrong character is enough to break a signed archive.
 * MCP has no way for a client to hand a server a file, so this gives two that
 * cannot go wrong silently:
 *
 * 1. `path`: a file inside one of the server's roots (fileRootsFrom). For a
 *    service that is typically an inbox its callers write and the service only
 *    reads; the bytes never pass through a model. A caller who owns that folder
 *    can plant a symbolic link in it to a file the SERVICE may read (its own
 *    grants), so the file is opened without following a link at the
 *    end, must be a regular file, and the file actually opened must lie inside
 *    a root, read back from /proc after the open, so a link anywhere in the
 *    path, or one swapped in after a check, is refused rather than followed.
 * 2. `content_base64` with a REQUIRED `sha256` of the SOURCE file: for a remote
 *    client, from a script that read the file. Decoded strictly, hashed, and
 *    refused as `checksum_mismatch` on any difference, before anything is
 *    stored or sent.
 *
 * Either way the caller gets the bytes, their sha256 and size, and a name, so
 * a result can say exactly what was taken.
 */

export type InputFile = {
  readonly bytes: Buffer;
  /** Hex SHA-256 of `bytes`. */
  readonly sha256: string;
  readonly size: number;
  /** The name given, else the path's basename; empty for base64 without one. */
  readonly name: string;
  /** For a path: the file actually opened (links resolved, read back from the kernel), so a caller can tell which root it came from. */
  readonly path?: string;
  /** For a path: its modification time, so a copy elsewhere can carry the same one. */
  readonly modified?: Date;
};

/** One file, given exactly one way. */
export type FileSource = {
  /** A file inside a root; a relative path is taken from the first root. */
  readonly path?: string | undefined;
  /** The bytes as standard base64, written by a script, never typed. Needs `sha256`. */
  readonly contentBase64?: string | undefined;
  /** Hex SHA-256 of the SOURCE file: required with `contentBase64`, checked when given with `path`. */
  readonly sha256?: string | undefined;
  readonly name?: string | undefined;
};

export type InputFileOptions = {
  /** Absolute directories a path must lie inside (fileRootsFrom). None: paths are refused. */
  readonly roots: readonly string[];
  readonly maxBytes?: number;
};

/** Gmail's own ceiling for a message; a server that takes less passes its own. */
export const INPUT_FILE_MAX_BYTES = 25 * 1024 * 1024;

const refuse = (code: InputFileCode, message: string): never => failInputFile({ kind: "input", code, message });

const sizeText = (bytes: number): string => `${bytes} bytes`;

/** Reads to the end, but never more than `maxBytes`: a file that grows while it is read is refused, not truncated. */
const readBounded = async (handle: FileHandle, path: string, maxBytes: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.alloc(Math.min(1 << 20, maxBytes + 1 - total));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) return Buffer.concat(chunks, total);
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
    if (total > maxBytes) return refuse("too_large", `${path} is over ${sizeText(maxBytes)}`);
  }
};

/** The file a handle really is: the kernel's own answer on Linux, the resolved name elsewhere. */
const openedPath = (handle: FileHandle, fallback: string): Promise<string> =>
  readlink(`/proc/self/fd/${handle.fd}`).catch(() => realpath(fallback));

type Read = { readonly bytes: Buffer; readonly name: string; readonly path?: string; readonly modified?: Date };

const fromPath = async (path: string, roots: readonly string[], maxBytes: number): Promise<Read> => {
  if (roots.length === 0) {
    return refuse("no_roots", "this server reads no file paths here (MCP_FILE_ROOTS is not set)");
  }
  const wanted = isAbsolute(path) ? resolve(path) : resolve(roots[0] as string, path);
  const realRoots = (await Promise.all(roots.map((root) => realpath(root).catch(() => undefined)))).filter(
    (root): root is string => root !== undefined,
  );
  const where = roots.join(" or ");
  if (!insideAny([...roots, ...realRoots], wanted)) return refuse("outside_roots", `${path} is not inside ${where}`);

  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const handle = await open(wanted, flags).catch((cause: NodeJS.ErrnoException): never => {
    if (cause.code === "ELOOP" || cause.code === "EMLINK") return refuse("symlink", `${path} is a symbolic link; put the file itself in ${where}`);
    if (cause.code === "ENOENT" || cause.code === "ENOTDIR") return refuse("not_found", `${path} does not exist in ${where}`);
    return refuse("unreadable", `${path} cannot be opened by this server (${cause.code ?? "error"})`);
  });
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return refuse("not_a_file", `${path} is not a regular file`);
    const actual = await openedPath(handle, wanted);
    if (!insideAny(realRoots, actual)) return refuse("outside_roots", `${path} leads outside ${where} through a link`);
    if (stat.size > maxBytes) return refuse("too_large", `${path} is ${sizeText(stat.size)}, over ${sizeText(maxBytes)}`);
    return { bytes: await readBounded(handle, path, maxBytes), name: basename(wanted), path: actual, modified: stat.mtime };
  } finally {
    await handle.close();
  }
};

const fromBase64 = (text: string, expected: string | undefined, maxBytes: number): Read => {
  if (expected === undefined) {
    return refuse("sha256_required", "content_base64 needs sha256: the hex SHA-256 of the source file, computed by the script that encoded it");
  }
  // Refused before decoding when even its shortest reading is over the cap (whitespace allowed for
  // a wrapped encoding): a large body must not cost a decode only to be turned away.
  if (Math.floor((text.length * 3) / 4) > Math.ceil(maxBytes * 1.05) + 3) {
    return refuse("too_large", `content_base64 is ${text.length} characters, over ${sizeText(maxBytes)} once decoded`);
  }
  const bytes = decodeBase64Strict(text) ?? refuse("bad_base64", "content_base64 is not standard base64 with its padding");
  if (bytes.length > maxBytes) return refuse("too_large", `content_base64 holds ${sizeText(bytes.length)}, over ${sizeText(maxBytes)}`);
  return { bytes, name: "" };
};

export const readInputFile = async (
  source: FileSource,
  { roots, maxBytes = INPUT_FILE_MAX_BYTES }: InputFileOptions,
): Promise<InputFile> => {
  const byPath = source.path !== undefined && source.path !== "";
  const byContent = source.contentBase64 !== undefined;
  if (byPath === byContent) return refuse("source", "give the file exactly one way: path, or content_base64 with sha256");
  const given = source.sha256?.trim() ?? "";
  const expected =
    given === "" ? undefined : (parseSha256(given) ?? refuse("bad_sha256", `sha256 must be 64 hex characters, got "${given.slice(0, 80)}"`));

  const read = byPath
    ? await fromPath(source.path as string, roots, maxBytes)
    : fromBase64(source.contentBase64 as string, expected, maxBytes);
  const sha256 = sha256Of(read.bytes);
  if (expected !== undefined && expected !== sha256) {
    return failInputFile({
      kind: "checksum_mismatch",
      message: `the ${sizeText(read.bytes.length)} that arrived hash to ${sha256}, not to the source's ${expected}`,
      expected_sha256: expected,
      actual_sha256: sha256,
      size: read.bytes.length,
    });
  }
  return {
    bytes: read.bytes,
    sha256,
    size: read.bytes.length,
    name: source.name?.trim() || read.name,
    ...(read.path === undefined ? {} : { path: read.path }),
    ...(read.modified === undefined ? {} : { modified: read.modified }),
  };
};

/**
 * A reader bound to its roots, with the sentences a tool description needs,
 * derived from the same roots so what a tool says and what it accepts cannot
 * differ: `where` for a path argument, `help` for a file argument that also
 * takes base64.
 */
export type InputFiles = ((source: FileSource) => Promise<InputFile>) & {
  /** The roots known without asking a client: MCP_FILE_ROOTS, or the fallback when a stdio client shares none. */
  readonly roots: readonly string[];
  /** Where a path must point, e.g. "a file in /srv/inbox/google (copy it there; a bare name is taken from there)". */
  readonly where: string;
  /** How to hand over a file at all: by path, or base64 from a script, never typed. */
  readonly help: string;
};

export type InputFilesOptions = {
  readonly maxBytes?: number;
  /**
   * A command that sends a file with its sha256, named in `help` for agents
   * that have one (MCP_FILE_SCRIPT, e.g. a wrapper that adds `--attach <file>`).
   */
  readonly script?: string | undefined;
};

const NEVER_TYPED = "Never type or paste a file's base64 yourself: a retyped file can arrive changed.";

export const inputFilesWith = (
  roots: readonly string[],
  { maxBytes, script, shared }: InputFilesOptions & {
    /** The client's own folders, asked per call; `roots` is then only the fallback (stdio). */
    readonly shared?: () => Promise<readonly string[]>;
  } = {},
): InputFiles => {
  const rootsNow = async (): Promise<readonly string[]> => {
    const theirs = shared === undefined ? [] : await shared();
    return theirs.length > 0 ? theirs : roots;
  };
  const reader = async (source: FileSource): Promise<InputFile> =>
    readInputFile(source, { roots: await rootsNow(), ...(maxBytes === undefined ? {} : { maxBytes }) });
  const sender = `have a script that read the file send content_base64 with its sha256${script ? ` (${script})` : ""}`;
  const fallback = roots.join(" or ");
  const where =
    shared !== undefined
      ? `a file in your workspace folders (the roots this client shares with the server; without them ${fallback}); a bare name is taken from the first`
      : roots.length === 0
        ? "a path, which this server does not take here (MCP_FILE_ROOTS is not set)"
        : `a file in ${fallback} (copy it there with cp; a bare name is taken from ${roots[0] as string})`;
  const help =
    shared !== undefined
      ? `${NEVER_TYPED} Give the path of a file in your workspace folders (the roots this client shares; without them ${fallback}), or ${sender}.`
      : roots.length === 0
        ? `${NEVER_TYPED} This server takes no paths here: ${sender}.`
        : `${NEVER_TYPED} Copy the file into ${fallback} and give its path, or ${sender}.`;
  return Object.assign(reader, { roots, where, help });
};

/** This process's reader, for a server's composition: `inputFilesFrom(process.env)`. */
export const inputFilesFrom = (env: NodeJS.ProcessEnv, { cwd = process.cwd(), maxBytes }: { readonly cwd?: string; readonly maxBytes?: number } = {}): InputFiles =>
  inputFilesWith(fileRootsFrom(env, cwd), {
    ...(maxBytes === undefined ? {} : { maxBytes }),
    script: env["MCP_FILE_SCRIPT"]?.trim() || undefined,
    // Over stdio with no roots configured, the client's own folders, asked when a file is read.
    ...(clientRootsApply(env) ? { shared: clientRoots } : {}),
  });

export { decodeBase64Strict, fileRootsFrom, parseSha256, sha256Of };
