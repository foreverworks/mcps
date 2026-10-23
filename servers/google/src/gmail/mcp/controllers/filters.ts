import { z } from "zod";

import { createFilter, deleteFilter, listFilters } from "../../app/usecases/filters.js";
import { handled } from "../envelope.js";
import { accountArg, writeAccountArg } from "./account.js";
import type { Registrar } from "./types.js";

type CreateArgs = {
  from?: string | undefined;
  to?: string | undefined;
  subject?: string | undefined;
  query?: string | undefined;
  negated_query?: string | undefined;
  has_attachment?: boolean | undefined;
  add: string[];
  remove: string[];
  discard: boolean;
  account: string;
};

export const registerFilters: Registrar = (server, registry) => {
  server.registerTool(
    "list_filters",
    {
      title: "List filters",
      description:
        "The mailbox's Gmail filters: criteria, the labels each adds and removes (by name), and `query`, the search " +
        "its criteria amount to, for applying it to mail already there with modify_labels_matching.",
      inputSchema: { account: accountArg() },
    },
    handled((args: { account: string }) => listFilters(registry.get(args.account))),
  );

  server.registerTool(
    "create_filter",
    {
      title: "Create filter",
      description:
        "Create a Gmail filter for mail that arrives from now on. Actions are labels, by name or id: add a label to " +
        "file it; remove INBOX to skip the inbox, UNREAD to mark it read; add STARRED or IMPORTANT. Adding TRASH or SPAM " +
        "needs discard: true, since such mail is never seen. No forwarding. " +
        "It does not touch mail already there: the result's filter.query is the search to give modify_labels_matching " +
        "for that. Gmail has no filter update; to change one, create the new one and delete the old. Needs the " +
        "gmail.settings.basic scope on the account's grant, and says so if it is missing.",
      inputSchema: {
        from: z.string().optional().describe("Sender: an address, a domain (e.g. news.example.com), or Gmail's from: syntax."),
        to: z.string().optional().describe("Recipient, as in Gmail's to:."),
        subject: z.string().optional().describe("Words in the subject."),
        query: z.string().optional().describe("Any Gmail search (\"Has the words\"), e.g. 'list:github.com OR from:notifications@github.com'."),
        negated_query: z.string().optional().describe("\"Doesn't have\": none of these words."),
        has_attachment: z.boolean().optional(),
        add: z.array(z.string()).default([]).describe("Labels to add (names or ids). Create a missing one first with create_label."),
        remove: z.array(z.string()).default([]).describe("Labels to remove: INBOX skips the inbox, UNREAD marks read."),
        discard: z.boolean().default(false).describe("Allow add to hold TRASH or SPAM: arriving mail then goes there unseen."),
        account: writeAccountArg(),
      },
    },
    handled((args: CreateArgs) =>
      createFilter(registry.get(args.account), {
        criteria: {
          ...(args.from !== undefined ? { from: args.from } : {}),
          ...(args.to !== undefined ? { to: args.to } : {}),
          ...(args.subject !== undefined ? { subject: args.subject } : {}),
          ...(args.query !== undefined ? { query: args.query } : {}),
          ...(args.negated_query !== undefined ? { negatedQuery: args.negated_query } : {}),
          ...(args.has_attachment !== undefined ? { hasAttachment: args.has_attachment } : {}),
        },
        add: args.add,
        remove: args.remove,
        discard: args.discard,
      }),
    ),
  );

  server.registerTool(
    "delete_filter",
    {
      title: "Delete filter",
      description: "Delete a Gmail filter by id (list_filters). Mail it already filed keeps its labels.",
      inputSchema: { filter_id: z.string(), account: writeAccountArg() },
    },
    handled((args: { filter_id: string; account: string }) => deleteFilter(registry.get(args.account), args.filter_id)),
  );
};
