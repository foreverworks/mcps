import { z } from "zod";

import { searchAccounts } from "../../app/usecases/search.js";
import { MAX_MESSAGES, readMessage, readMessages, readThread } from "../../app/usecases/threads.js";
import { parseDetail } from "../../domain/detail.js";
import { handled } from "../envelope.js";
import { accountArg } from "./account.js";
import type { Registrar } from "./types.js";

const DETAIL_DOC =
  "How much comes back. 'metadata' = headers and snippet only, the cheapest fetch; it carries " +
  "NO attachment list, because Gmail's metadata format does not return the MIME tree at all. " +
  "'text' (default) adds the attachment list plus each body as readable text, CONVERTING a message " +
  "that ships only HTML rather than dumping markup; each message carries bodySource so you know " +
  "which you got. 'raw_html' is 'text' with the markup exactly as sent, for parsing it yourself.";

const detail = z.enum(["metadata", "text", "raw_html"]).default("text").describe(DETAIL_DOC);

export const registerThreads: Registrar = (server, registry) => {
  server.registerTool(
    "search_threads",
    {
      title: "Search threads",
      description:
        "Search threads with Gmail query syntax, e.g. 'from:billing.example.com after:2026/01/01 has:attachment', " +
        "'subject:invoice newer_than:30d', 'label:INBOX is:unread'. Searches EVERY registered mailbox by " +
        "default and tags each result with the account it came from, so a question that does not know which " +
        "mailbox holds the answer needs one call. Returns summaries; use get_thread for bodies.",
      inputSchema: {
        query: z.string().default("").describe("Gmail query syntax. Empty means the whole mailbox."),
        max_results: z.number().int().min(1).max(50).default(20).describe("Per account, not in total."),
        page_token: z
          .string()
          .default("")
          .describe("From a previous call's per-account nextPageToken. Page ONE account at a time."),
        account: accountArg("all"),
      },
    },
    handled((args: { query: string; max_results: number; page_token: string; account: string }) =>
      searchAccounts(registry.select(args.account), {
        ...(args.query ? { query: args.query } : {}),
        maxResults: args.max_results,
        ...(args.page_token ? { pageToken: args.page_token } : {}),
      }),
    ),
  );

  server.registerTool(
    "get_thread",
    {
      title: "Get thread",
      description:
        "Fetch one thread with all its messages, their attachment metadata and their bodies. Thread ids " +
        "are per-mailbox: pass the account that search_threads reported alongside the id.",
      inputSchema: { thread_id: z.string(), detail, account: accountArg() },
    },
    handled((args: { thread_id: string; detail: string; account: string }) =>
      readThread(registry.get(args.account), args.thread_id, parseDetail(args.detail)),
    ),
  );

  server.registerTool(
    "get_message",
    {
      title: "Get message",
      description: "Fetch a single message by id. See get_thread for the detail levels and the account rule.",
      inputSchema: { message_id: z.string(), detail, account: accountArg() },
    },
    handled((args: { message_id: string; detail: string; account: string }) =>
      readMessage(registry.get(args.account), args.message_id, parseDetail(args.detail)),
    ),
  );

  server.registerTool(
    "get_messages",
    {
      title: "Get messages",
      description:
        `Fetch several messages of one mailbox in one call, up to ${MAX_MESSAGES} ids, in the order given (a repeated id once). ` +
        "Use it after list_history or a search when you need the bodies of messages from different threads. A message " +
        "that cannot be read comes back as {id, partial: true, reason} in its place and the others still arrive. See " +
        "get_thread for the detail levels and the account rule; 'metadata' keeps a long list cheap.",
      inputSchema: {
        message_ids: z.array(z.string().min(1)).min(1).max(MAX_MESSAGES).describe("Message ids from one mailbox, as search_threads, get_thread or list_history report them."),
        detail,
        account: accountArg(),
      },
    },
    handled((args: { message_ids: string[]; detail: string; account: string }) =>
      readMessages(registry.get(args.account), args.message_ids, parseDetail(args.detail)),
    ),
  );
};
