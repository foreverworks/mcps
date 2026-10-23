import { ambiguousError, fail, notFoundError } from "../../domain/errors.js";
import { shape, type Entry, type RawFile } from "../../domain/entries.js";
import { driveId, isRootPath, joinPath, ROOT_ID, splitPath } from "../../domain/path.js";
import type { Deps, SearchSpec } from "../ports.js";
import { required } from "../../domain/errors.js";

export type Resolved = { readonly id: string; readonly path: string; readonly entry: Entry | null };

/**
 * Path to id, one segment at a time.
 *
 * There is no endpoint for this: Drive addresses files by id, and a path is a
 * chain of `name = ... and parent in ...` queries. Each hop is a round trip,
 * which is why every other use case takes an id when it has one and a path only
 * as a convenience.
 *
 * A segment that matches more than once raises `ambiguous` instead of choosing.
 * Choosing would be a coin flip that writes.
 */
export const resolvePath = async (deps: Deps, path: string): Promise<Resolved> => {
  if (isRootPath(path)) return { id: ROOT_ID, path: "", entry: null };

  const segments = splitPath(path);
  let parentId = ROOT_ID;
  let last: RawFile | undefined;

  for (const [index, segment] of segments.entries()) {
    const matches = await deps.drive.childrenNamed(parentId, segment);
    const here = joinPath(segments.slice(0, index + 1));
    if (matches.length === 0) return fail(notFoundError(`no "${segment}" in ${joinPath(segments.slice(0, index)) || "the root"}`));
    if (matches.length > 1) {
      return fail(
        ambiguousError(
          `${matches.length} objects answer to ${here}`,
          matches.map((m) => `${m.id} (${m.mimeType})`),
        ),
      );
    }
    last = matches[0] as RawFile;
    parentId = required(last.id, "file id");
  }

  return { id: parentId, path: joinPath(segments), entry: last ? shape(last) : null };
};

/**
 * An id if one was given, otherwise a path walked, otherwise the root.
 *
 * Empty meaning the root is not a shrug: the root is a real folder that tools
 * have to be able to name, and it is the one folder with no name to give. The
 * cost is that a caller who forgot an argument lists the root instead of being
 * told, which is why every tool's description says so outright.
 */
export const targetId = async (deps: Deps, fileId: string, path: string): Promise<string> => {
  if (fileId) return driveId(fileId);
  if (isRootPath(path)) return ROOT_ID;
  return (await resolvePath(deps, path)).id;
};

export const listFolder = async (
  deps: Deps,
  args: { readonly fileId: string; readonly path: string; readonly includeTrashed: boolean; readonly limit: number },
): Promise<{ readonly folderId: string; readonly entries: readonly Entry[] }> => {
  const folderId = await targetId(deps, args.fileId, args.path);
  const raw = await deps.drive.listChildren(folderId, { includeTrashed: args.includeTrashed, limit: args.limit });
  return { folderId, entries: raw.map(shape) };
};

export const find = async (deps: Deps, spec: SearchSpec): Promise<readonly Entry[]> =>
  (await deps.drive.search(spec)).map(shape);

export const describe = async (deps: Deps, args: { readonly fileId: string; readonly path: string }): Promise<Entry> =>
  shape(await deps.drive.get(await targetId(deps, args.fileId, args.path)));
