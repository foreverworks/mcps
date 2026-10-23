import { z } from "zod";

import { listHistory } from "../../app/usecases/history.js";
import { handled } from "../envelope.js";
import { accountArg } from "./account.js";
import type { Registrar } from "./types.js";

export const registerHistory: Registrar = (server, registry) => {
  server.registerTool(
    "list_history",
    {
      title: "List history",
      description:
        "Messages added since a historyId: incremental sync instead of re-searching the same window. " +
        "Take the anchor from health's historyId, store it, pass it back next run. Anchors are per-mailbox, " +
        "so keep one per account. Gmail expires old anchors: a 404 here means the anchor is too old and a " +
        "full search_threads is needed to re-baseline.",
      inputSchema: {
        start_history_id: z.string(),
        max_results: z.number().int().min(1).max(500).default(100),
        page_token: z.string().default(""),
        account: accountArg(),
      },
    },
    handled((args: { start_history_id: string; max_results: number; page_token: string; account: string }) =>
      listHistory(registry.get(args.account), {
        startHistoryId: args.start_history_id,
        maxResults: args.max_results,
        ...(args.page_token ? { pageToken: args.page_token } : {}),
      }),
    ),
  );
};
