import { z } from "zod";

import { createDraft, deleteDraft, getDraft, listDrafts, sendDraft, updateDraft } from "../../app/usecases/drafts.js";
import { parseDetail } from "../../domain/detail.js";
import { handled } from "../envelope.js";
import { accountArg, writeAccountArg } from "./account.js";
import { type ComposeArgs, composeInput, composeShape, OUTWARD } from "./composeArgs.js";
import type { Registrar } from "./types.js";

export const registerDrafts: Registrar = (server, registry) => {
  server.registerTool(
    "create_draft",
    {
      title: "Create draft",
      description:
        "Save a NEW message as a draft. The default path for anything addressed to someone: nothing leaves the " +
        "mailbox, and the result carries the draft's webUrl for the user to review and send. For an answer to an " +
        "existing message use reply (it drafts by default and threads properly), not this.",
      inputSchema: { ...composeShape(registry.inputFiles), account: writeAccountArg() },
    },
    handled((args: ComposeArgs & { account: string }) => createDraft(registry.get(args.account), composeInput(args))),
  );

  server.registerTool(
    "update_draft",
    {
      title: "Update draft",
      description:
        "Change an existing draft. Only the fields you pass change; everything else, including a reply draft's " +
        "threading, is kept. Passing either body replaces both bodies. Attachments are kept unless you pass a " +
        "list, and an empty list removes them.",
      inputSchema: { draft_id: z.string(), ...composeShape(registry.inputFiles), account: writeAccountArg() },
    },
    handled((args: ComposeArgs & { draft_id: string; account: string }) =>
      updateDraft(registry.get(args.account), args.draft_id, composeInput(args)),
    ),
  );

  server.registerTool(
    "get_draft",
    {
      title: "Get draft",
      description: "One draft: its message (headers, Bcc included, bodies and attachments) and its webUrl.",
      inputSchema: {
        draft_id: z.string(),
        detail: z.enum(["metadata", "text", "raw_html"]).default("text").describe("As on get_message."),
        account: accountArg(),
      },
    },
    handled((args: { draft_id: string; detail: string; account: string }) =>
      getDraft(registry.get(args.account), args.draft_id, parseDetail(args.detail)),
    ),
  );

  server.registerTool(
    "list_drafts",
    {
      title: "List drafts",
      description: "The account's drafts, newest first, with recipients, subject, snippet and each draft's webUrl.",
      inputSchema: {
        query: z.string().default("").describe("Gmail query syntax to filter drafts. Empty means all."),
        max_results: z.number().int().min(1).max(100).default(20),
        page_token: z.string().default(""),
        account: accountArg(),
      },
    },
    handled((args: { query: string; max_results: number; page_token: string; account: string }) =>
      listDrafts(registry.get(args.account), {
        ...(args.query ? { query: args.query } : {}),
        maxResults: args.max_results,
        ...(args.page_token ? { pageToken: args.page_token } : {}),
      }),
    ),
  );

  server.registerTool(
    "delete_draft",
    {
      title: "Delete draft",
      description: "Delete a draft permanently (drafts do not go to Trash). The draft's message is gone with it.",
      inputSchema: { draft_id: z.string(), account: writeAccountArg() },
    },
    handled((args: { draft_id: string; account: string }) => deleteDraft(registry.get(args.account), args.draft_id)),
  );

  server.registerTool(
    "send_draft",
    {
      title: "Send draft",
      description: `Send an existing draft as it stands. ${OUTWARD} Returns the sent message's webUrl.`,
      inputSchema: { draft_id: z.string(), account: writeAccountArg() },
    },
    handled((args: { draft_id: string; account: string }) => sendDraft(registry.get(args.account), args.draft_id)),
  );
};
