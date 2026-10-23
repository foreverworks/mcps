import { z } from "zod";

import { saveAttachment } from "../../app/usecases/attachments.js";
import { harvestAttachments } from "../../app/usecases/harvest.js";
import { handled } from "../envelope.js";
import { accountArg } from "./account.js";
import type { Registrar } from "./types.js";

export const registerAttachments: Registrar = (server, registry) => {
  server.registerTool(
    "get_attachment",
    {
      title: "Download attachment",
      description:
        "Download one attachment to disk by message_id + attachment_id (both come from get_thread). " +
        "This is the capability Google's own Gmail MCP server does not have: it reports an " +
        "attachment's name and id and gives you no way to fetch the bytes. Returns the path, size and sha256; " +
        "a download whose size differs from the one Gmail reports for the part is refused and nothing is saved. " +
        "A different file already saved under the name is kept, and this one is saved as \"name (2).ext\".",
      inputSchema: {
        message_id: z.string(),
        attachment_id: z.string(),
        save_dir: z.string().default("").describe("A folder INSIDE the account's attachments folder (e.g. \"2026-09/invoices\"); empty for the folder itself. Copy files from the result's path to where they belong."),
        filename: z.string().default("").describe("Defaults to <attachment_id>.bin. Path separators are stripped."),
        account: accountArg(),
      },
    },
    handled((args: { message_id: string; attachment_id: string; save_dir: string; filename: string; account: string }) =>
      saveAttachment(registry.get(args.account), {
        messageId: args.message_id,
        attachmentId: args.attachment_id,
        ...(args.save_dir ? { saveDir: args.save_dir } : {}),
        ...(args.filename ? { filename: args.filename } : {}),
      }),
    ),
  );

  server.registerTool(
    "harvest_attachments",
    {
      title: "Harvest attachments for a query",
      description:
        "Every attachment matching a Gmail query, downloaded to a folder in ONE call, with a manifest. " +
        "Use it for a month of invoices ('has:attachment after:2026/08/01 before:2026/09/01') instead of " +
        "walking threads and calling get_attachment per file. Do NOT use Gmail's own 'download all " +
        "attachments' zip as an alternative: it is keyed by thread id and silently omits parts keyed by " +
        "message id. Returns counts (threadsMatched, attachmentsFound, savedCount) so the harvest can be " +
        "reconciled against Gmail's own has:attachment count, each saved file with its size and sha256, plus a " +
        "per-file failure list. Files are named <message id>-<filename>; two of one name both survive. A client that asks " +
        "for progress hears each attachment saved, out of how many; cancelling stops the harvest, which then ends as cancelled.",
      inputSchema: {
        query: z.string().default("has:attachment").describe("Gmail query syntax. Narrow it with a date window."),
        max_threads: z.number().int().min(1).max(100).default(50).describe("Threads scanned. Page with the query."),
        max_attachments: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(200)
          .describe("Hard cap on files written. `truncated: true` in the result means you hit it."),
        extensions: z
          .array(z.string())
          .default([])
          .describe("Filter by extension, e.g. ['.pdf','.xml']. Empty means every attachment."),
        save_dir: z.string().default("").describe("A folder INSIDE the account's attachments folder (e.g. \"2026-09/invoices\"); empty for the folder itself. Copy files from the result's path to where they belong."),
        account: accountArg(),
      },
    },
    handled(
      (args: {
        query: string;
        max_threads: number;
        max_attachments: number;
        extensions: string[];
        save_dir: string;
        account: string;
      }) =>
        harvestAttachments(registry.get(args.account), {
          query: args.query,
          maxThreads: args.max_threads,
          maxAttachments: args.max_attachments,
          extensions: args.extensions,
          ...(args.save_dir ? { saveDir: args.save_dir } : {}),
        }),
    ),
  );
};
