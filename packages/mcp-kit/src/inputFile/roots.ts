import { delimiter, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Where a server may read a file BY PATH. Pure: the environment and the
 * working directory come in as arguments.
 *
 * - `MCP_FILE_ROOTS`, a list of directories (`:` between them): for a service,
 *   typically an inbox its callers write and the service only reads.
 * - Unset over stdio: the working directory, i.e. the folder the person who
 *   started the server works in, which is theirs to read anyway; and when the
 *   client shares its own folders (MCP roots), those instead (clientRoots.ts).
 * - Unset over HTTP: none. A service's working directory is its code, and a
 *   client of a shared service has no business reading it.
 */
export const fileRootsFrom = (env: NodeJS.ProcessEnv, cwd: string): readonly string[] => {
  const listed = (env["MCP_FILE_ROOTS"] ?? "")
    .split(delimiter)
    .map((root) => root.trim())
    .filter((root) => root !== "");
  if (listed.length > 0) return listed.map((root) => resolve(cwd, root));
  return env["MCP_HTTP_PORT"]?.trim() ? [] : [cwd];
};

/**
 * Whether the client's own folders (MCP roots) decide: over stdio, when the
 * deployment names no roots. Then they replace the working directory, which
 * stays the fallback for a client that shares none.
 */
export const clientRootsApply = (env: NodeJS.ProcessEnv): boolean =>
  (env["MCP_FILE_ROOTS"] ?? "").trim() === "" && !env["MCP_HTTP_PORT"]?.trim();

/** `path` is `root` or below it. Both absolute and normalised; string work only. */
export const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

export const insideAny = (roots: readonly string[], path: string): boolean => roots.some((root) => isInside(root, path));
