import { inputFilesWith, type InputFiles } from "@foreverworks/mcp-kit";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Sources } from "../app/ports.js";
import { fail, inputError } from "../domain/errors.js";

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/**
 * The files a path names, read through the kit's reader (O_NOFOLLOW, regular
 * files only, the real path re-checked inside a root). A folder is walked
 * here, in name order, without following a link anywhere: a link is counted
 * and passed over, so an agent cannot plant one that points out of a root.
 * Only files of a format the server reads are listed; the walk stops at
 * `limit` of them and says so.
 */
export const makeSources = (roots: readonly string[], options: { readonly maxBytes: number; readonly script?: string | undefined }): Sources => {
  const read: InputFiles = inputFilesWith(roots, { maxBytes: options.maxBytes, script: options.script });

  const resolveInRoot = async (path: string): Promise<string> => {
    if (roots.length === 0) return fail({ kind: "config", variable: "RAG_SOURCE_ROOTS", message: "no folder is allowed to index from: set MCP_FILE_ROOTS or RAG_SOURCE_ROOTS" });
    const first = roots[0] ?? "";
    const wanted = isAbsolute(path) ? resolve(path) : resolve(first, path);
    let real: string;
    try {
      real = await realpath(wanted);
    } catch {
      return fail(inputError(`${wanted} does not exist or cannot be read`));
    }
    const realRoots = await Promise.all(roots.map((r) => realpath(r).catch(() => r)));
    if (real !== wanted && (await lstat(wanted)).isSymbolicLink()) return fail(inputError(`${wanted} is a link; give the path it points to, inside ${roots.join(" or ")}`));
    if (!realRoots.some((r) => inside(r, real))) return fail(inputError(`${wanted} is outside the folders this server may read (${roots.join(", ")})`));
    return real;
  };

  const list: Sources["list"] = async (path, { recursive, limit, readable }) => {
    const start = await resolveInRoot(path);
    const top = await lstat(start);
    if (top.isFile()) return { files: readable(start) ? [start] : [], unreadable: readable(start) ? 0 : 1, links: 0, truncated: false, folder: false, path: start };
    if (!top.isDirectory()) return fail(inputError(`${start} is neither a file nor a folder`));
    const files: string[] = [];
    let unreadable = 0;
    let links = 0;
    let truncated = false;
    const walk = async (dir: string): Promise<void> => {
      const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (truncated) return;
        if (entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) links += 1;
        else if (entry.isFile()) {
          if (!readable(entry.name)) unreadable += 1;
          else if (files.length >= limit) truncated = true;
          else files.push(full);
        } else if (entry.isDirectory() && recursive) await walk(full);
      }
    };
    await walk(start);
    return { files, unreadable, links, truncated, folder: true, path: start.endsWith(sep) && start !== sep ? start.slice(0, -1) : start };
  };

  return { read, list, roots };
};
