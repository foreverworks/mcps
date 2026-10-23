import { z } from "zod";

/** The argument schemas several tools share, so one word means one thing in every tool. */

export const project = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe('The project: "@account/slug" (e.g. "@acme/my-app"), its slug, or its id. Leave it out when the token sees one project (list_projects).');

export const platform = z.enum(["ios", "android"]).optional();

export const limit = (fallback: number, max: number) => z.number().int().min(1).max(max).default(fallback);

export const offset = z.number().int().min(0).default(0).describe("Skip this many, newest first: nextOffset from the previous call.");

export const lines = (fallback: number) =>
  z.number().int().min(0).max(500).default(fallback).describe("How many of a step's last log lines to include (0: none).");

export const steps = z.boolean().default(false).describe("Also list every step of the log with its result.");

export const id = (what: string) => z.string().trim().min(1).describe(what);

/** The arguments a tool's input shape parses to. */
export type ArgsOf<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;
