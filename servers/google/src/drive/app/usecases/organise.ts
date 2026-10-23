import { fail, inputError } from "../../domain/errors.js";
import { FOLDER_MIME, shape, type Entry, type RawFile } from "../../domain/entries.js";
import { planMove, type MoveItem, type MovePlan } from "../../domain/plan.js";
import { driveId, isRootPath, splitPath } from "../../domain/path.js";
import type { Deps } from "../ports.js";
import { resolvePath, targetId } from "./browse.js";
import { required } from "../../domain/errors.js";

export type MoveRequest = {
  /** Each source is a path or an `id:<fileId>`, so one call can mix the two. */
  readonly sources: readonly string[];
  readonly destinationPath: string;
  readonly destinationId: string;
  /** Rename while moving. Only legal for a single source. */
  readonly renameTo: string;
  readonly dryRun: boolean;
};

const ID_PREFIX = "id:";

const loadSource = async (deps: Deps, source: string): Promise<{ raw: RawFile; entry: Entry }> => {
  const raw = source.startsWith(ID_PREFIX)
    ? await deps.drive.get(driveId(source.slice(ID_PREFIX.length)))
    : await deps.drive.get((await resolvePath(deps, source)).id);
  return { raw, entry: shape(raw) };
};

/**
 * Move files, and say what it would do first.
 *
 * The plan is computed against the destination's CURRENT contents and against
 * the other sources in the same call, so a batch that would collide with itself
 * is caught before the first write rather than halfway through it.
 */
export const move = async (deps: Deps, request: MoveRequest): Promise<{ readonly plan: MovePlan; readonly applied: readonly Entry[] }> => {
  if (request.sources.length === 0) return fail(inputError("no sources given"));
  if (request.renameTo && request.sources.length > 1) {
    return fail(inputError("rename_to moves one file; give a single source or drop the rename"));
  }

  const destinationId = await targetId(deps, request.destinationId, request.destinationPath);
  const occupantList = await deps.drive.listChildren(destinationId, { includeTrashed: false, limit: 1000 });
  // A child with no name or id cannot collide with anything, so it is left out rather than keyed "".
  const occupants = new Map(occupantList.flatMap((f) => (f.name && f.id ? [[f.name, f.id] as const] : [])));

  const items: MoveItem[] = [];
  for (const source of request.sources) {
    const { raw, entry } = await loadSource(deps, source);
    items.push({ entry, currentParents: raw.parents ?? [], targetName: request.renameTo || entry.name });
  }

  const plan = planMove(items, destinationId, occupants);
  if (request.dryRun) return { plan, applied: [] };

  const applied: Entry[] = [];
  for (const step of plan.steps) {
    if (step.verdict === "blocked" || step.verdict === "already_there") continue;
    const patch = {
      addParents: [destinationId],
      removeParents: step.item.currentParents,
      ...(step.item.targetName === step.item.entry.name ? {} : { name: step.item.targetName }),
    };
    applied.push(shape(await deps.drive.update(step.item.entry.id, patch)));
  }
  return { plan, applied };
};

export const rename = async (
  deps: Deps,
  args: { readonly fileId: string; readonly path: string; readonly newName: string },
): Promise<Entry> => {
  if (!args.newName.trim()) return fail(inputError("new_name is empty"));
  if (args.newName.includes("/")) return fail(inputError('a Drive name cannot contain "/"'));
  return shape(await deps.drive.update(await targetId(deps, args.fileId, args.path), { name: args.newName }));
};

/**
 * Create a folder, and every missing folder above it.
 *
 * Walking down and creating what is missing costs one query per level, which is
 * the same price `resolvePath` pays anyway. Doing it in one call matters because
 * the alternative is an agent creating `Legal`, then `Legal/Contracts`, then
 * discovering at the third hop that it misspelled the first.
 */
export const makeFolder = async (deps: Deps, path: string): Promise<{ readonly id: string; readonly created: readonly string[] }> => {
  if (isRootPath(path)) return fail(inputError("give a path under the root"));
  const segments = splitPath(path);
  const created: string[] = [];
  let parentId = "root";

  for (const segment of segments) {
    const matches = await deps.drive.childrenNamed(parentId, segment);
    const folder = matches.find((m) => m.mimeType === FOLDER_MIME);
    if (folder) {
      parentId = required(folder.id, "folder id");
      continue;
    }
    if (matches.length > 0) return fail(inputError(`"${segment}" exists and is not a folder`));
    const made = await deps.drive.createFile(segment, FOLDER_MIME, parentId);
    created.push(segment);
    parentId = required(made.id, "folder id");
  }
  return { id: parentId, created };
};

/**
 * Trash, not delete.
 *
 * Drive keeps a trashed file for 30 days, so every destructive call this server
 * makes is reversible by construction rather than by the caller being careful.
 * There is deliberately no permanent-delete tool: the one operation that cannot
 * be taken back is the one an agent should not be able to reach.
 */
export const trash = async (deps: Deps, args: { readonly fileId: string; readonly path: string }): Promise<Entry> =>
  shape(await deps.drive.update(await targetId(deps, args.fileId, args.path), { trashed: true }));

export const untrash = async (deps: Deps, args: { readonly fileId: string; readonly path: string }): Promise<Entry> =>
  shape(await deps.drive.update(await targetId(deps, args.fileId, args.path), { trashed: false }));

/**
 * Where a file sits, as a path, by walking parents back to the root.
 *
 * The stop condition is the root's REAL id, fetched once: `files.get` reports a
 * top-level file's parent as that id, never the literal "root" alias, so a walk
 * that compared against the alias would climb one level too far and prefix
 * every path with "My Drive".
 */
export const pathOf = async (deps: Deps, fileId: string): Promise<string> => {
  const rootId = (await deps.drive.get("root")).id;
  const segments: string[] = [];
  const seen = new Set<string>();
  let current: RawFile | undefined = await deps.drive.get(driveId(fileId));

  while (current && current.id !== rootId) {
    segments.unshift(required(current.name, "file name"));
    const parentId = current.parents?.[0];
    if (parentId === undefined || parentId === rootId || seen.has(parentId)) break;
    seen.add(parentId);
    current = await deps.drive.get(parentId);
  }
  return segments.join("/");
};

/** A native copy retains Google formats and formulas; folders require an explicit tree walk. */
export const copyFile = async (
  deps: Deps,
  args: { readonly fileId: string; readonly destinationId: string; readonly name: string; readonly expectedModified?: string },
): Promise<Entry> => {
  const source = await deps.drive.get(driveId(args.fileId));
  if (source.mimeType === FOLDER_MIME || source.trashed) return fail(inputError("copy_file needs a non-trashed file, not a folder"));
  if (args.expectedModified !== undefined && source.modifiedTime !== args.expectedModified) {
    return fail(inputError("source changed since it was read; inspect it before copying"));
  }
  const destination = await deps.drive.get(driveId(args.destinationId, "folder id"));
  if (destination.mimeType !== FOLDER_MIME || destination.trashed) return fail(inputError("destination_id must be a non-trashed folder"));
  const name = args.name || required(source.name, "file name");
  if (!name.trim()) return fail(inputError("name is empty"));
  if ((await deps.drive.childrenNamed(args.destinationId, name)).length > 0) {
    return fail(inputError("destination already contains that name; inspect it before retrying"));
  }
  return shape(await deps.drive.copy(args.fileId, name, args.destinationId));
};
