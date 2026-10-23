import { z } from "zod";

import { fileIdArg, readAccountArg, writeAccountArg } from "../../../editors/mcp/args.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import { addComment, deleteComment, editComment, listComments, replyToComment } from "../../app/usecases/comments.js";
import type { Registry } from "../../composition.js";
import { handled } from "../envelope.js";

const commentIdArg = () => z.string().min(1).describe("The comment's id, from list_comments.");

/** Comment threads on any Drive file: read, write, reply, resolve. */
export const registerComments: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "list_comments",
    {
      title: "List a file's comments",
      description:
        "The comment threads on a Doc, Sheet, deck or any Drive file, each with its author, time, text, the text it quotes, " +
        "whether it is resolved, and its replies (with any resolve or reopen action). Counts the open and resolved threads.",
      inputSchema: {
        account: readAccountArg(),
        file_id: fileIdArg("file"),
        include_resolved: z.boolean().default(true),
        include_deleted: z.boolean().default(false),
        modified_after: z.string().default("").describe("RFC 3339; only threads changed since (a new reply counts)."),
        max_results: z.number().int().min(1).max(1000).default(200),
      },
    },
    handled((args: { account: string; file_id: string; include_resolved: boolean; include_deleted: boolean; modified_after: string; max_results: number }) =>
      listComments(registry.get(args.account), {
        fileId: args.file_id,
        includeResolved: args.include_resolved,
        includeDeleted: args.include_deleted,
        modifiedAfter: args.modified_after,
        limit: args.max_results,
      }),
    ),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Comment on a file",
      description:
        "A new comment thread on a Drive file, as the account. `quoted` shows the text it is about beside it. Google Docs shows a " +
        "comment made through the API on the file, not anchored to text (Google's limit); `anchor` is for file types whose viewer reads one. " +
        "Everyone with access to the file sees it.",
      inputSchema: {
        account: writeAccountArg(),
        file_id: fileIdArg("file"),
        content: z.string().min(1),
        quoted: z.string().default("").describe("The passage the comment is about."),
        anchor: z.string().default("").describe("Drive's anchor JSON, for non-Google files."),
      },
    },
    handled((args: { account: string; file_id: string; content: string; quoted: string; anchor: string }) =>
      addComment(registry.get(args.account), { fileId: args.file_id, content: args.content, quoted: args.quoted, anchor: args.anchor }),
    ),
  );

  server.registerTool(
    "reply_to_comment",
    {
      title: "Reply to, resolve or reopen a comment",
      description: "A reply on a comment thread, and/or its resolve or reopen (`action`), as the account; what the comment box's Reply and Resolve buttons do.",
      inputSchema: {
        account: writeAccountArg(),
        file_id: fileIdArg("file"),
        comment_id: commentIdArg(),
        content: z.string().default(""),
        action: z.enum(["", "resolve", "reopen"]).default(""),
      },
    },
    handled((args: { account: string; file_id: string; comment_id: string; content: string; action: "" | "resolve" | "reopen" }) =>
      replyToComment(registry.get(args.account), { fileId: args.file_id, commentId: args.comment_id, content: args.content, action: args.action }),
    ),
  );

  server.registerTool(
    "edit_comment",
    {
      title: "Edit a comment or reply",
      description: "New text for a comment, or for one of its replies with reply_id. Drive lets an account edit only what it wrote.",
      inputSchema: {
        account: writeAccountArg(),
        file_id: fileIdArg("file"),
        comment_id: commentIdArg(),
        reply_id: z.string().default("").describe("A reply's id, to edit the reply rather than the comment."),
        content: z.string().min(1),
      },
    },
    handled((args: { account: string; file_id: string; comment_id: string; reply_id: string; content: string }) =>
      editComment(registry.get(args.account), { fileId: args.file_id, commentId: args.comment_id, replyId: args.reply_id, content: args.content }),
    ),
  );

  server.registerTool(
    "delete_comment",
    {
      title: "Delete a comment or reply",
      description: "Delete a comment thread with its replies, or one reply with reply_id. Drive lets an account delete only what it wrote (owners excepted).",
      inputSchema: { account: writeAccountArg(), file_id: fileIdArg("file"), comment_id: commentIdArg(), reply_id: z.string().default("") },
    },
    handled((args: { account: string; file_id: string; comment_id: string; reply_id: string }) =>
      deleteComment(registry.get(args.account), { fileId: args.file_id, commentId: args.comment_id, replyId: args.reply_id }),
    ),
  );
};
