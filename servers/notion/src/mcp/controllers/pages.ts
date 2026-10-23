import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { createPage, movePage, readPage, setTrashed, updatePage } from "../../app/usecases/pages.js";
import { account, allowNewOptions, page, properties, propertiesAgain, source } from "../args.js";
import { handled } from "../envelope.js";
import type { ArgsOf, Registrar } from "./types.js";

const icon = z.string().trim().min(1).max(16).describe("An emoji for the page's icon.");

const READ = {
  page,
  content: z.boolean().default(true).describe("Include the body as Markdown. false reads the properties alone, which is cheaper."),
  include_transcript: z.boolean().default(false).describe("For a meeting-notes page, include the transcript."),
  account,
};

const CREATE = {
  parent: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Where it goes: a database (id, URL or dataSourceId) for a new row, or a page for a child page. Leave it out for a private page at the top level of the workspace account names."),
  source,
  title: z.string().optional().describe("The title. For a row, this fills the database's title column."),
  properties,
  markdown: z.string().optional().describe("The body, in Notion's Markdown. Notion takes a leading '# ' heading as the title, so start the body below it."),
  icon: icon.optional(),
  template: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'For a row: "default" for the database\'s default template, or a template\'s name or id (list_database_templates). Notion ' +
        "fills the row's body and properties from it just after making it; properties given here are kept. Not with markdown.",
    ),
  allow_new_options: allowNewOptions,
  account,
};

const UPDATE = {
  page,
  properties: propertiesAgain,
  icon: icon.nullable().optional().describe("An emoji for the page's icon; null removes it."),
  allow_new_options: allowNewOptions,
  account,
};

const MOVE = {
  page,
  to: z.string().trim().min(1).describe("The new parent: a page, or a database (the page becomes a row). Same workspace only."),
  source,
  account,
};

const TRASH = { page, account };

export const registerPages: Registrar = (server, deps) => {
  const trashArgs = { ...TRASH, allow_template: z.boolean().default(false).describe("Explicitly allow removing a database template after checking its role in list_database_templates.") };
  server.registerTool(
    "read_page",
    {
      title: "Read a page",
      description:
        "One page by id or URL, in whichever workspace has it: its title, parent and properties as plain values " +
        "(a select is its option's name, a relation its page ids, all of them), and its body as Notion's Markdown. Empty " +
        "properties are left out. A body past Notion's limit (~20,000 blocks) comes back cut, with contentTruncated and " +
        "the ids of the parts left out, each readable as a page. A database's id is refused: use describe_database.",
      inputSchema: READ,
    },
    handled((args: ArgsOf<typeof READ>) =>
      readPage(deps, { page: args.page, content: args.content, includeTranscript: args.include_transcript, ...compact({ account: args.account }) }),
    ),
  );

  server.registerTool(
    "create_page",
    {
      title: "Create a page",
      description:
        "A new row in a database, its properties checked against the columns first (an unknown column or option is " +
        "refused with the ones that exist), a child page under a page, or with no parent a private page at the top of a " +
        "workspace (a title and a body, no properties). The body " +
        "is Notion's Markdown. A row can start from one of its database's templates (template): Notion applies it just " +
        "after the page is made, so read_page a moment later shows what it filled in. Answers the new page's workspace, id " +
        "and URL. A page is not created twice: if the answer is lost it is outcome_unknown, and search or query_database " +
        "says whether it exists.",
      inputSchema: CREATE,
    },
    handled((args: ArgsOf<typeof CREATE>) =>
      createPage(deps, {
        properties: args.properties,
        allowNewOptions: args.allow_new_options,
        ...compact({ parent: args.parent, source: args.source, title: args.title, markdown: args.markdown, icon: args.icon, template: args.template, account: args.account }),
      }),
    ),
  );

  server.registerTool(
    "update_page",
    {
      title: "Update a page",
      description:
        "Change a page's properties (a row's columns, checked against the database's schema; a page's title as " +
        "properties: {title: ...}) and its icon. Only the columns named change. Answers the page as read_page does, " +
        "without the body. The body is changed with append_content, edit_content and replace_content.",
      inputSchema: UPDATE,
    },
    handled((args: ArgsOf<typeof UPDATE>) =>
      updatePage(deps, { page: args.page, properties: args.properties, allowNewOptions: args.allow_new_options, ...compact({ icon: args.icon, account: args.account }) }),
    ),
  );

  server.registerTool(
    "move_page",
    {
      title: "Move a page",
      description:
        "Under another page, or into a database as a row. Only within the page's own workspace: Notion cannot move a " +
        "page between workspaces.",
      inputSchema: MOVE,
    },
    handled((args: ArgsOf<typeof MOVE>) => movePage(deps, { page: args.page, to: args.to, ...compact({ source: args.source, account: args.account }) })),
  );

  server.registerTool(
    "trash_page",
    {
      title: "Trash a page",
      description: "Into Notion's trash, with everything under it. Direct deletion of database templates is refused unless allow_template is explicit. Notion keeps trash 30 days; restore_page brings it back.",
      inputSchema: trashArgs,
    },
    handled((args: ArgsOf<typeof trashArgs>) => setTrashed(deps, { page: args.page, allowTemplate: args.allow_template, ...compact({ account: args.account }) }, true)),
  );

  server.registerTool(
    "restore_page",
    {
      title: "Restore a page",
      description:
        "Out of Notion's trash, back where it was. Notion's API cannot restore a page from the top level of a workspace " +
        "(it answers a validation error); that one is restored from the Trash in Notion.",
      inputSchema: TRASH,
    },
    handled((args: ArgsOf<typeof TRASH>) => setTrashed(deps, { page: args.page, ...compact({ account: args.account }) }, false)),
  );
};
