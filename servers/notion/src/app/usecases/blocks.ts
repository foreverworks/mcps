import { compact } from "@foreverworks/mcp-kit";

import { type Block, toBlock } from "../../domain/blocks.js";
import { toBlockId } from "../../domain/ids.js";
import type { Deps } from "../ports.js";

/** Notion's most blocks in one page of children. */
const PAGE_SIZE = 100;

export type ReadBlocksArgs = { readonly block: string; readonly limit: number; readonly cursor?: string; readonly account?: string };

/**
 * The blocks directly inside a page or a block, in order, up to `limit`, a page
 * of 100 at a time, and the cursor after the last one read. A partial block
 * (only its id) has nothing to show and is left out.
 */
export const readBlocks = async (deps: Deps, args: ReadBlocksArgs) => {
  const id = toBlockId(args.block);
  const account = await deps.locator.accountOf(id, ["block"], args.account);
  const api = deps.accounts.api(account);
  const blocks: Block[] = [];
  let cursor = args.cursor;
  do {
    const listed = await api.listBlockChildren(id, Math.min(PAGE_SIZE, args.limit - blocks.length), cursor);
    for (const b of listed.results) if ("type" in b) blocks.push(toBlock(b));
    cursor = listed.has_more ? (listed.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined && blocks.length < args.limit);
  return compact({ account, block: id, count: blocks.length, blocks, nextCursor: cursor });
};
