import { z } from "zod";

import { modifyLabelsMatching } from "../../app/usecases/matching.js";
import { markSpam, modifyLabels, trash, unmarkSpam, untrash } from "../../app/usecases/organize.js";
import { handled } from "../envelope.js";
import { writeAccountArg } from "./account.js";
import type { Registrar } from "./types.js";

const target = z
  .enum(["message", "thread"])
  .default("thread")
  .describe("Act on whole threads (default, what Gmail's own buttons do) or on single messages.");

const ids = z.array(z.string()).min(1).max(1000).describe("Thread or message ids, per `target`, from this account.");

export const registerOrganize: Registrar = (server, registry) => {
  server.registerTool(
    "modify_labels",
    {
      title: "Modify labels",
      description:
        "Add and remove labels on threads or messages. In Gmail these ARE the everyday actions: archive = remove " +
        "INBOX; mark read = remove UNREAD (unread = add it); star = add STARRED; important = IMPORTANT. Labels may be " +
        "given by id or by name, case-insensitively. For threads, ids that failed are listed under `failed` beside the ones changed.",
      inputSchema: {
        target,
        ids,
        add: z.array(z.string()).default([]),
        remove: z.array(z.string()).default([]),
        account: writeAccountArg(),
      },
    },
    handled((args: { target: "message" | "thread"; ids: string[]; add: string[]; remove: string[]; account: string }) =>
      modifyLabels(registry.get(args.account), args),
    ),
  );

  server.registerTool(
    "modify_labels_matching",
    {
      title: "Modify labels on every match",
      description:
        "Add and remove labels on EVERY thread a Gmail search matches, as Gmail's \"select all conversations that " +
        "match this search\" does: file a sender under a label and archive it (add the label, remove INBOX), mark " +
        "old mail read (remove UNREAD). A dry run by default: it returns how many threads match and a sample, and " +
        "changes nothing. With dry_run false it refuses when the search matches more than `limit`, and otherwise " +
        "changes every match, listing any thread that failed. To be able to find and reverse a large change later, " +
        "also add a marker label created for it (e.g. 'cleanup/2026-10').",
      inputSchema: {
        query: z.string().min(1).describe("Gmail query syntax, e.g. 'in:inbox from:news.example.com' or 'in:inbox older_than:90d'."),
        add: z.array(z.string()).default([]).describe("Labels to add, by name or id."),
        remove: z.array(z.string()).default([]).describe("Labels to remove: INBOX archives, UNREAD marks read."),
        dry_run: z.boolean().default(true).describe("True (default): count and sample only. False: apply."),
        limit: z.number().int().min(1).max(10000).default(1000).describe("The most threads one call may change."),
        account: writeAccountArg(),
      },
    },
    handled((args: { query: string; add: string[]; remove: string[]; dry_run: boolean; limit: number; account: string }) =>
      modifyLabelsMatching(registry.get(args.account), {
        query: args.query,
        add: args.add,
        remove: args.remove,
        apply: !args.dry_run,
        limit: args.limit,
      }),
    ),
  );

  server.registerTool(
    "trash",
    {
      title: "Trash",
      description:
        "Move threads or messages to Trash, where Gmail keeps them 30 days. There is no permanent delete here. " +
        "Returns the ids trashed, and any that failed under `failed`.",
      inputSchema: { target, ids, account: writeAccountArg() },
    },
    handled((args: { target: "message" | "thread"; ids: string[]; account: string }) => trash(registry.get(args.account), args)),
  );

  server.registerTool(
    "untrash",
    {
      title: "Untrash",
      description: "Bring threads or messages back out of Trash. Returns the ids restored, and any that failed under `failed`.",
      inputSchema: { target, ids, account: writeAccountArg() },
    },
    handled((args: { target: "message" | "thread"; ids: string[]; account: string }) => untrash(registry.get(args.account), args)),
  );

  server.registerTool(
    "mark_spam",
    {
      title: "Mark as spam",
      description: "Report threads or messages as spam: into SPAM and out of the inbox, as Gmail's own button does.",
      inputSchema: { target, ids, account: writeAccountArg() },
    },
    handled((args: { target: "message" | "thread"; ids: string[]; account: string }) => markSpam(registry.get(args.account), args)),
  );

  server.registerTool(
    "unmark_spam",
    {
      title: "Not spam",
      description: "Take threads or messages out of SPAM and back into the inbox.",
      inputSchema: { target, ids, account: writeAccountArg() },
    },
    handled((args: { target: "message" | "thread"; ids: string[]; account: string }) => unmarkSpam(registry.get(args.account), args)),
  );
};
