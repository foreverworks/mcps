import { z } from "zod";

import { senderBreakdown } from "../../app/usecases/senders.js";
import { handled } from "../envelope.js";
import { accountArg } from "./account.js";
import type { Registrar } from "./types.js";

export const registerSenders: Registrar = (server, registry) => {
  server.registerTool(
    "sender_breakdown",
    {
      title: "Sender breakdown",
      description:
        "Who the threads matching a query come from: per sending domain, busiest first, the thread and unread " +
        "counts, the newest and oldest date, and its busiest addresses. The starting point for sorting a mailbox " +
        "into labels and filters. A thread's sender is the author of its latest message you did not send. " +
        "One mailbox per call. A few hundred threads take seconds; past that Gmail's quota allows about 25 " +
        "threads a second, so a 3000-thread inbox takes about two minutes.",
      inputSchema: {
        query: z.string().default("in:inbox").describe("Gmail query syntax; default the inbox."),
        limit: z.number().int().min(1).max(10000).default(3000).describe("Threads scanned at most; `more` says whether the query matched more."),
        top: z.number().int().min(1).max(200).default(40).describe("Domains listed; the rest are summed in otherDomains."),
        account: accountArg(),
      },
    },
    handled((args: { query: string; limit: number; top: number; account: string }) =>
      senderBreakdown(registry.get(args.account), { query: args.query, limit: args.limit, top: args.top }),
    ),
  );
};
