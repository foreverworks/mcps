import { shape, type Entry } from "../../domain/entries.js";
import type { Deps } from "../ports.js";

export type ChangeRow = {
  readonly fileId: string;
  readonly removed: boolean;
  readonly entry: Entry | null;
};

export type ChangeReport = {
  readonly cursor: string;
  readonly changes: readonly ChangeRow[];
  readonly exhausted: boolean;
};

/**
 * "What changed since last time", as one request.
 *
 * This is the primitive a file mirror does not have, and the reason a sync
 * there costs a full listing of both sides: a bisync that transfers nothing
 * still spends nearly all its time listing every object.
 * `changes.list` against a saved token answers the same question in one call
 * that returns only the delta, which is what makes a near-live mirror
 * affordable rather than a matter of shortening the timer.
 *
 * `cursor` is opaque and belongs to the caller: hand back what the previous
 * call returned. `start_cursor` with no argument mints one meaning "from now".
 */
export const currentCursor = async (deps: Deps): Promise<{ readonly cursor: string }> => ({
  cursor: await deps.drive.startPageToken(),
});

export const changesSince = async (
  deps: Deps,
  args: { readonly cursor: string; readonly limit: number },
): Promise<ChangeReport> => {
  const batch = await deps.drive.changes(args.cursor, args.limit);
  return {
    // A page token when there is more, the new start token when caught up.
    cursor: batch.nextPageToken ?? batch.newStartPageToken ?? args.cursor,
    exhausted: batch.nextPageToken === undefined,
    changes: batch.changes.map((c) => ({
      fileId: c.fileId,
      removed: c.removed,
      entry: c.file ? shape(c.file) : null,
    })),
  };
};
