import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { addComment, getComments } from "../../app/usecases/comments.js";
import { account, cursor, page } from "../args.js";
import { handled } from "../envelope.js";
import type { ArgsOf, Registrar } from "./types.js";

const GET = {
  page,
  limit: z.number().int().min(1).max(100).default(50).describe("Comments per call."),
  cursor,
  account,
};

const ADD = {
  page,
  markdown: z.string().min(1).describe("The comment, in Markdown."),
  discussion: z.string().trim().optional().describe("A discussionId from get_comments, to reply in that thread. Default: a new comment on the page."),
  account,
};

export const registerComments: Registrar = (server, deps) => {
  server.registerTool(
    "get_comments",
    {
      title: "Get comments",
      description: "The open comments on a page, oldest first, each with its discussion, author, time and text. Resolved ones are not listed by Notion.",
      inputSchema: GET,
    },
    handled((args: ArgsOf<typeof GET>) =>
      getComments(deps, { page: args.page, limit: args.limit, ...compact({ cursor: args.cursor, account: args.account }) }),
    ),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add a comment",
      description:
        "A comment on a page, or a reply in one of its discussions, shown in Notion as the workspace's integration. " +
        "Not resent after a lost answer (outcome_unknown): get_comments says whether it arrived.",
      inputSchema: ADD,
    },
    handled((args: ArgsOf<typeof ADD>) =>
      addComment(deps, { page: args.page, markdown: args.markdown, ...compact({ discussion: args.discussion, account: args.account }) }),
    ),
  );
};
