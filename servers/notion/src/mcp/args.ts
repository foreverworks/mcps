import { z } from "zod";

import { ALL_ACCOUNTS } from "../domain/accounts.js";
import { RELATIVE_DATES, RELATIVE_RANGES } from "../domain/query/filter.js";

/**
 * The argument schemas several tools share, so one word means one thing in
 * every tool's input.
 */

export const account = z
  .string()
  .trim()
  .optional()
  .describe(`Workspace: a label list_accounts names ("${ALL_ACCOUNTS}": every one). Rarely needed: an id or URL finds its own.`);

export const page = z.string().trim().min(1).describe("The page: its id, or its Notion URL (a row of a database is a page too).");

export const database = z
  .string()
  .trim()
  .min(1)
  .describe("The database: its id, its Notion URL, or the dataSourceId search returned for it.");

export const source = z
  .string()
  .trim()
  .optional()
  .describe("Which table, only when the database holds several (describe_database lists them): its name or id.");

export const cursor = z.string().trim().min(1).optional().describe("nextCursor from the previous call, exactly as it came back, to read on.");

export const allowNewOptions = z
  .boolean()
  .default(false)
  .describe("Let a select or multi-select value add an option the column does not have yet. A status can never be added.");

export const properties = z
  .record(z.string(), z.unknown())
  .default({})
  .describe(
    "Column name -> value, checked against the database's columns (describe_database). Text and title: a string. " +
      "Number: a number. Select and status: an existing option's name. Multi-select: a list of names. Date: " +
      '"YYYY-MM-DD", an ISO date-time, or {start, end, time_zone}. Checkbox: true or false. URL, email, phone: a string. ' +
      "Relation: page ids or URLs. Files: external URLs. null clears a column. Computed columns (formula, rollup, " +
      "created/edited time and by, unique id) cannot be written.",
  );

/** The same values, for a second tool: the types are listed once, in create_page. */
export const propertiesAgain = z
  .record(z.string(), z.unknown())
  .default({})
  .describe("Column name -> value, as create_page's properties take them; only the columns named change. A page under a page: {title: ...}.");

const OPS =
  "Text: equals, does_not_equal, contains, does_not_contain, starts_with, ends_with. Number: equals, does_not_equal, " +
  "greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to. Checkbox: equals. Select and status: " +
  "equals, does_not_equal (one option or a list: any of them). Multi-select: contains, does_not_contain. Date: equals, " +
  `before, after, on_or_before, on_or_after, or with no value ${RELATIVE_RANGES.join(", ")}. Relation: contains (a ` +
  'page id). People, created by, edited by: contains, does_not_contain (a name, an email, a user id, or "me"). Any ' +
  "column: is_empty, is_not_empty.";

const condition = (opHelp: string, valueHelp: string) =>
  z.object({
    property: z.string().trim().min(1).optional().describe("A column, by name."),
    timestamp: z.enum(["created_time", "last_edited_time"]).optional().describe("Or a page's own timestamp."),
    op: z.string().trim().min(1).describe(opHelp),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional().describe(valueHelp),
  });

export const where = z
  .array(condition(OPS, `What to compare with. Dates: YYYY-MM-DD, an ISO date-time, or ${RELATIVE_DATES.join(", ")}.`))
  .default([])
  .describe('Conditions on the columns, e.g. [{"property": "Status", "op": "equals", "value": "In progress"}]. The column type comes from the schema.');

/** The same conditions, for a second tool: the ops are listed once, in query_database. */
export const whereAgain = z
  .array(condition("As in query_database's where.", "As in query_database's where."))
  .default([])
  .describe("Conditions on the columns, exactly as query_database's where takes them.");

export const match = z.enum(["all", "any"]).default("all").describe("Whether a row must meet all the conditions in where, or any of them.");

export const notionFilter = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Notion's own filter object, for what where cannot say (nested and/or, rollups). ANDed with where when both are given.");

export const sort = z
  .array(
    z.object({
      property: z.string().trim().min(1).optional().describe("A column, by name."),
      timestamp: z.enum(["created_time", "last_edited_time"]).optional(),
      direction: z.enum(["ascending", "descending"]).default("ascending"),
    }),
  )
  .default([])
  .describe("The order, first key first. Default: Notion's (the database's own order).");

export const inTrash = z.boolean().default(false).describe("Rows in Notion's trash instead of the live ones.");
