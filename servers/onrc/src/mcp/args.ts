import { z } from "zod";

/** The argument schemas the listing tools share, so one word means one thing in every tool. */

export const from = z.string().trim().optional().describe("First day of the window, YYYY-MM-DD (Bucharest). Default: 365 days ago.");
export const to = z.string().trim().optional().describe("Last day of the window, YYYY-MM-DD (Bucharest). Default: today in Bucharest.");
export const page = z.number().int().min(0).default(0).describe("Page, from 0, newest first.");
export const size = z.number().int().min(1).max(100).default(20);

export const listing = { from, to, page, size };

/** A filing's id: the portal's UUID, so a number or a name pasted in its place fails here rather than as a 404. */
export const filingId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "a filing's id is a UUID, the `id` list_requests gives (not its number)")
  .describe("The filing's id (a UUID), from list_requests.");

/** The arguments a tool's input shape parses to. */
export type ArgsOf<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;
