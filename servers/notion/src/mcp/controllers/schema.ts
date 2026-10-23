import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { addColumn, addOptions, createDatabase } from "../../app/usecases/schema.js";
import { COLUMN_TYPES, DESCRIPTION_LIMIT, OPTION_LIMIT, STATUS_GROUPS } from "../../domain/schemaEdits.js";
import { account, database, source } from "../args.js";
import { handled } from "../envelope.js";
import type { ArgsOf, Registrar } from "./types.js";

const columnShape = z.object({
  name: z.string().trim().min(1).max(200).describe("The column's name; one the table does not have yet (case ignored)."),
  type: z.enum(COLUMN_TYPES).describe("Its type. Rollups, unique ids and buttons are made in Notion's app."),
  options: z.array(z.string().trim().min(1).max(100)).max(OPTION_LIMIT).optional().describe("Select, multi-select or status: its options, in order."),
  format: z.string().trim().min(1).optional().describe("Number: Notion's format name, e.g. number, number_with_commas, percent, euro, dollar."),
  expression: z.string().min(1).optional().describe("Formula: its expression, e.g. prop(\"Hours\") * prop(\"Rate\")."),
  relation_to: z.string().trim().min(1).optional().describe("Relation: the database it points at (id or URL), in the same workspace. One-way."),
  description: z.string().max(DESCRIPTION_LIMIT).optional().describe(`What the column is for, up to ${DESCRIPTION_LIMIT} characters.`),
});

type ColumnArgs = z.infer<typeof columnShape>;

const columnInput = (c: ColumnArgs) =>
  compact({ name: c.name, type: c.type, options: c.options, format: c.format, expression: c.expression, relationTo: c.relation_to, description: c.description });

const ADD_COLUMN = { database, source, column: columnShape, account };

const ADD_OPTIONS = {
  database,
  source,
  column: z.string().trim().min(1).describe("A select, multi-select or status column, by name."),
  options: z.array(z.string().trim().min(1).max(100)).min(1).max(OPTION_LIMIT).describe("The options to add; one already there is left as it is."),
  group: z.enum(STATUS_GROUPS).optional().describe("Status only: the group the new options go in. Default: To-do."),
  account,
};

const CREATE = {
  parent: z.string().trim().min(1).describe("The page it goes under: its id or Notion URL."),
  title: z.string().trim().min(1).max(2000).describe("The database's title."),
  title_column: z.string().trim().min(1).max(200).default("Name").describe("The name of its title column, which every row is known by. Default: Name."),
  columns: z.array(columnShape).max(100).default([]).describe("Its other columns, as add_column takes one."),
  inline: z.boolean().default(false).describe("Shown inside the page's body rather than as a page of its own."),
  account,
};

/** A database's columns and options changed, and new databases made, each checked against the schema first. */
export const registerSchema: Registrar = (server, deps) => {
  server.registerTool(
    "add_column",
    {
      title: "Add a column",
      description:
        "Add a column to a database: a name it does not have yet, a type, and that type's settings (options, a number's " +
        "format, a formula's expression, a relation's target). Checked against the table as it is now before anything is " +
        "sent; answers the column as Notion made it. Renaming and deleting columns are left to Notion's app.",
      inputSchema: ADD_COLUMN,
    },
    handled((args: ArgsOf<typeof ADD_COLUMN>) => addColumn(deps, { database: args.database, column: columnInput(args.column), ...compact({ source: args.source, account: args.account }) })),
  );

  server.registerTool(
    "add_options",
    {
      title: "Add options to a column",
      description:
        "Add options to a select, multi-select or status column (a status option in a group: To-do, In progress, Complete). " +
        "The options already there are kept and sent back by id, and the column is read back after: an option that went " +
        "missing fails the call. Names already there are skipped and listed under alreadyThere. For one new option while " +
        "writing a row, create_page's allow_new_options is enough.",
      inputSchema: ADD_OPTIONS,
    },
    handled((args: ArgsOf<typeof ADD_OPTIONS>) =>
      addOptions(deps, { database: args.database, column: args.column, options: args.options, ...compact({ source: args.source, group: args.group, account: args.account }) }),
    ),
  );

  server.registerTool(
    "create_database",
    {
      title: "Create a database",
      description:
        "Create a database under a page, with a title column and the other columns given, each checked against the others " +
        "before anything is made (and a relation's target found in the same workspace). Answers its id, URL and table. A " +
        "database is not created twice: if the answer is lost it is outcome_unknown, and search says whether it exists.",
      inputSchema: CREATE,
    },
    handled((args: ArgsOf<typeof CREATE>) =>
      createDatabase(deps, {
        parent: args.parent,
        title: args.title,
        titleColumn: args.title_column,
        columns: args.columns.map(columnInput),
        inline: args.inline,
        ...compact({ account: args.account }),
      }),
    ),
  );
};
