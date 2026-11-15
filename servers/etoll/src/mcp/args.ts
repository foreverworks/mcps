import { z } from "zod";

/** The argument schemas the tools share, so one word means one thing in every tool. */

/** A calendar day: z.iso.date() refuses 2026-02-30 and puts `format: date` in the schema a model reads. */
const day = z.iso.date();

export const from = day.optional().describe("First day of the window, YYYY-MM-DD (Bucharest). Default: 365 days before `to`.");
export const to = day.optional().describe("Last day of the window, YYYY-MM-DD (Bucharest). Default: today in Bucharest.");
export const startDate = day.optional().describe("First day of validity, YYYY-MM-DD (Bucharest), today or later. Default: the first day eToll allows.");
export const page = z.number().int().min(0).default(0).describe("Page, from 0.");
export const size = z.number().int().min(1).max(100).default(20);

export const vehicle = z.string().trim().min(1).describe("The vehicle: its plate number as written on it (B123ABC; spaces and dashes do not matter), or its id from list_vehicles.");

export const id = (what: string) => z.string().trim().min(1).max(200).describe(what);

/** The arguments a tool's input shape parses to. */
export type ArgsOf<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;
