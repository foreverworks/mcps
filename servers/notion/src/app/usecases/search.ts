import { compact } from "@foreverworks/mcp-kit";

import { chooseAccounts } from "../../domain/accounts.js";
import { decodeCursors, encodeCursors } from "../../domain/cursor.js";
import { describeThrown } from "../../domain/errors.js";
import { type Hit, toHit } from "../../domain/models.js";
import type { RawSearch } from "../../domain/schema.js";
import type { Deps } from "../ports.js";

export type SearchArgs = {
  readonly query?: string;
  readonly kind?: "page" | "database";
  readonly account?: string;
  /** Per workspace: n workspaces answer up to n times this many. */
  readonly limit: number;
  readonly cursor?: string;
};

/**
 * Round robin across the workspaces' own orders: Notion ranks each list by
 * relevance (or newest edit, with no query), and there is no score to merge
 * two lists by, so the best of each stay near the top.
 */
const interleave = (lists: readonly (readonly Hit[])[]): readonly Hit[] => {
  const out: Hit[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i += 1) {
    for (const list of lists) {
      const hit = list[i];
      if (hit !== undefined) out.push(hit);
    }
  }
  return out;
};

/**
 * Pages and databases by title, in every workspace at once unless `account`
 * names one. A workspace that fails is reported beside the others' hits
 * rather than hiding them.
 */
export const search = async (deps: Deps, args: SearchArgs) => {
  const labels = chooseAccounts(args.account, await deps.accounts.labels());
  const cursors = args.cursor === undefined ? undefined : decodeCursors(args.cursor);
  const active = cursors === undefined ? labels : labels.filter((l) => Object.hasOwn(cursors, l));
  const answers = await Promise.all(
    active.map(async (label) => {
      try {
        const found: RawSearch = await deps.accounts.api(label).search(
          compact({ query: args.query, kind: args.kind, pageSize: args.limit, cursor: cursors?.[label] }),
        );
        return { label, found };
      } catch (thrown) {
        return { label, error: describeThrown(thrown) };
      }
    }),
  );

  const lists = answers.map((a) =>
    "found" in a && a.found !== undefined
      ? a.found.results.map((raw) => {
          const hit = toHit(a.label, raw);
          deps.locator.learn(hit.id, a.label, hit.kind === "page" ? "page" : "database");
          if (hit.dataSourceId !== undefined) deps.locator.learn(hit.dataSourceId, a.label, "data_source");
          return hit;
        })
      : [],
  );
  const next = Object.fromEntries(
    answers.flatMap((a) => ("found" in a && a.found?.has_more && a.found.next_cursor ? [[a.label, a.found.next_cursor] as const] : [])),
  );
  const failed = Object.fromEntries(answers.flatMap((a) => ("error" in a && a.error !== undefined ? [[a.label, a.error] as const] : [])));
  return compact({
    hits: interleave(lists),
    nextCursor: encodeCursors(next),
    failed: Object.keys(failed).length === 0 ? undefined : failed,
  });
};
