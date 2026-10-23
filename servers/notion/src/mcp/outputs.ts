import { z } from "zod";

/**
 * Output schemas (the kit's structured results) for the tools whose answers
 * have a fixed shape. A row's properties are as open as the database's columns,
 * so the tools that answer rows declare none.
 */

export const VIEWS_OUTPUT = z.strictObject({
  account: z.string(),
  database: z.string(),
  source: z.string().optional().describe("The table the views were narrowed to"),
  views: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string().optional(),
      type: z.string().describe("table, board, list, calendar, timeline, gallery, form, chart, map or dashboard"),
      dataSourceId: z.string().optional(),
      url: z.string().optional(),
      filter: z.record(z.string(), z.unknown()).optional().describe("The saved filter, Notion's query grammar, columns by name"),
      sorts: z.array(z.unknown()).optional(),
    }),
  ),
});

export const USERS_OUTPUT = z.strictObject({
  users: z.array(
    z.strictObject({
      account: z.string(),
      id: z.string(),
      name: z.string().optional(),
      type: z.enum(["person", "bot"]),
      email: z.string().optional(),
    }),
  ),
  failed: z.record(z.string(), z.string()).optional().describe("Workspaces that could not be read, with why"),
});
