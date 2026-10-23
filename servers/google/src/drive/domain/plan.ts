import type { Entry } from "./entries.js";

/**
 * What a move would do, decided before anything is written.
 *
 * Drive's API has no "move" — a move is `files.update` with `addParents` and
 * `removeParents`, and it will happily create a second file of the same name
 * beside the first, because Drive keys on id and not on path. So the checks
 * that a filesystem does for free have to be done here, and the plan is
 * returned to the caller BEFORE it is applied: every organise tool takes a
 * `dry_run` and the plan is what it prints.
 */

export type MoveItem = {
  readonly entry: Entry;
  /** The folder it is in today. Drive allows several; we move it out of all of them. */
  readonly currentParents: readonly string[];
  /** The name it will have at the destination, renamed or not. */
  readonly targetName: string;
};

export type MoveStep =
  | { readonly verdict: "move"; readonly item: MoveItem }
  | { readonly verdict: "rename_and_move"; readonly item: MoveItem; readonly from: string }
  | { readonly verdict: "already_there"; readonly item: MoveItem }
  | { readonly verdict: "blocked"; readonly item: MoveItem; readonly reason: string };

export type MovePlan = {
  readonly destinationId: string;
  readonly steps: readonly MoveStep[];
  readonly willWrite: number;
  readonly blocked: number;
};

/**
 * `occupants` is what the destination already holds, by name. A collision is
 * blocked rather than silently resolved: two files of one name in one folder is
 * exactly the state that makes a file mirror drop objects, and a tool
 * that created more of it would be undoing the reason it exists.
 */
export const planMove = (
  items: readonly MoveItem[],
  destinationId: string,
  occupants: ReadonlyMap<string, string>,
): MovePlan => {
  const claimed = new Map(occupants);
  const steps = items.map((item): MoveStep => {
    const holder = claimed.get(item.targetName);
    if (holder !== undefined && holder !== item.entry.id) {
      return { verdict: "blocked", item, reason: `"${item.targetName}" is already in the destination (id ${holder})` };
    }
    if (item.entry.isFolder && item.entry.id === destinationId) {
      return { verdict: "blocked", item, reason: "a folder cannot be moved into itself" };
    }
    claimed.set(item.targetName, item.entry.id);

    if (item.currentParents.length === 1 && item.currentParents[0] === destinationId) {
      return item.targetName === item.entry.name
        ? { verdict: "already_there", item }
        : { verdict: "rename_and_move", item, from: item.entry.name };
    }
    return item.targetName === item.entry.name
      ? { verdict: "move", item }
      : { verdict: "rename_and_move", item, from: item.entry.name };
  });

  return {
    destinationId,
    steps,
    willWrite: steps.filter((s) => s.verdict === "move" || s.verdict === "rename_and_move").length,
    blocked: steps.filter((s) => s.verdict === "blocked").length,
  };
};
