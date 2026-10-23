import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { appendContent, editPageContent, replaceContent } from "../../app/usecases/content.js";
import { UPDATE_LIMIT } from "../../domain/content.js";
import { account, page } from "../args.js";
import { handled } from "../envelope.js";
import type { ArgsOf, Registrar } from "./types.js";

const MARKDOWN = "Notion's Markdown: headings, lists, to-dos (- [ ]), quotes, code, tables, callouts.";

const markdown = z.string().describe(MARKDOWN);

const allowDeleting = z
  .boolean()
  .default(false)
  .describe("Let the change remove child pages or databases inside the page. Off, Notion refuses such a change.");

const APPEND = {
  page,
  markdown,
  at: z.enum(["end", "start"]).default("end").describe("Where it goes."),
  after: z.string().optional().describe('Or after a passage, named "first words...last words" as it reads in the page.'),
  account,
};

const EDIT = {
  page,
  edits: z
    .array(
      z.object({
        old: z.string().describe("Text to find, exactly as it reads in the page's Markdown (read_page)."),
        new: z.string().describe("What replaces it; empty deletes it."),
        all: z.boolean().default(false).describe("Replace every place it appears. Off, a text found twice is refused."),
      }),
    )
    .min(1)
    .max(UPDATE_LIMIT)
    .describe("Find-and-replace pairs, applied in order."),
  allow_deleting: allowDeleting,
  account,
};

const REPLACE = {
  page,
  markdown: z.string().describe(`${MARKDOWN} The page's new body; empty only with clear.`),
  clear: z
    .boolean()
    .default(false)
    .describe('Empty the body on purpose, with markdown "". Without it an empty markdown is refused, since it would erase the page.'),
  allow_deleting: allowDeleting,
  account,
};

const NOT_TWICE =
  " Not resent after a lost answer: that is outcome_unknown, and read_page says whether it went through.";

export const registerContent: Registrar = (server, deps) => {
  server.registerTool(
    "append_content",
    {
      title: "Add to a page",
      description: `Markdown added to a page's body: at the end (default), at the start, or after a passage.${NOT_TWICE}`,
      inputSchema: APPEND,
    },
    handled((args: ArgsOf<typeof APPEND>) =>
      appendContent(deps, { page: args.page, markdown: args.markdown, at: args.at, ...compact({ after: args.after, account: args.account }) }),
    ),
  );

  server.registerTool(
    "edit_content",
    {
      title: "Edit a page",
      description:
        "Find and replace in a page's body, in its Markdown as read_page shows it. The smallest change that does the " +
        `job: the rest of the page, its comments and its history stay as they were.${NOT_TWICE}`,
      inputSchema: EDIT,
    },
    handled((args: ArgsOf<typeof EDIT>) =>
      editPageContent(deps, { page: args.page, edits: args.edits, allowDeleting: args.allow_deleting, ...compact({ account: args.account }) }),
    ),
  );

  server.registerTool(
    "replace_content",
    {
      title: "Replace a page's body",
      description:
        "A page's whole body, replaced by this Markdown. Properties are untouched. Child pages and databases in the " +
        "body are kept unless allow_deleting. An empty body needs clear: true. Answers with the page's title and how many " +
        "blocks its body held before and after; check both. Prefer edit_content for a change to part of a page.",
      inputSchema: REPLACE,
    },
    handled((args: ArgsOf<typeof REPLACE>) =>
      replaceContent(deps, { page: args.page, markdown: args.markdown, allowDeleting: args.allow_deleting, clear: args.clear, ...compact({ account: args.account }) }),
    ),
  );
};
