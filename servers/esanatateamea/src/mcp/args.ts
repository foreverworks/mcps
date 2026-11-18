import { z } from "zod";

/** The argument schemas the tools share, so one word means one thing in every tool. */

export const from = z.string().trim().optional().describe("First day of the window, YYYY-MM-DD (Bucharest). Default: 365 days before `to`.");
export const to = z.string().trim().optional().describe("Last day of the window, YYYY-MM-DD (Bucharest). Default: today.");
export const page = z.number().int().min(0).default(0).describe("Page, from 0, newest first.");
export const size = z.number().int().min(1).max(100).default(20);

/** A document's id as the portal lists it: letters, digits and dashes, so a title pasted in its place fails here rather than as a 404. */
export const documentId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,80}$/, "a document's id is the `id` list_medical_documents gives (not its title)")
  .describe("The document's id, from list_medical_documents.");

/** The arguments a tool's input shape parses to. */
export type ArgsOf<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;
