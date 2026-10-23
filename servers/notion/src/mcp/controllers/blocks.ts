import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { readBlocks } from "../../app/usecases/blocks.js";
import { account, cursor } from "../args.js";
import { handled } from "../envelope.js";
import type { ArgsOf, Registrar } from "./types.js";

const READ = {
  block: z
    .string()
    .trim()
    .min(1)
    .describe("The page or block: its id, or a Notion URL. A URL's #fragment names a block inside the page, and that block is the one read."),
  limit: z.number().int().min(1).max(1000).default(100).describe("Blocks to return; more than 100 are read 100 at a time."),
  cursor,
  account,
};

export const registerBlocks: Registrar = (server, deps) => {
  server.registerTool(
    "read_blocks",
    {
      title: "Read blocks",
      description:
        "The blocks directly inside a page or a block, in order, one level down: each one's id, type and plain text, " +
        "and hasChildren when it holds more (read those by its id). An AI meeting-notes block answers its title, " +
        "status, recording and calendar times, and the ids of the blocks that hold its summary, notes and transcript, " +
        "each readable here in turn. A type the API does not support says its Notion name under unsupported. For a " +
        "page's body as one text, read_page is cheaper.",
      inputSchema: READ,
    },
    handled((args: ArgsOf<typeof READ>) =>
      readBlocks(deps, { block: args.block, limit: args.limit, ...compact({ cursor: args.cursor, account: args.account }) }),
    ),
  );
};
