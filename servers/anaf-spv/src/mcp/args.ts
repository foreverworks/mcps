import { isIsoDate } from "@foreverworks/mcp-kit";
import { z } from "zod";

/** The argument shapes several tools share. The shape is checked here; what it means, in app/ and domain/. */

export const isoDate = (what: string) =>
  z
    .string()
    .trim()
    .refine(isIsoDate, { message: "a calendar date, YYYY-MM-DD" })
    .optional()
    .describe(`${what}: a calendar date in Bucharest, YYYY-MM-DD, inclusive.`);

export const selection = {
  type: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Only this SPV document type, as list_messages' `types` names it: DECIZIE, SOMATII, NOTIFICARE, RASPUNS SOLICITARE, PLATA, RECIPISA, ... (case and diacritics ignored)."),
  since: isoDate("Posted on or after"),
  until: isoDate("Posted on or before"),
  cif: z.string().trim().min(1).optional().describe("Only documents for this tax id (a CNP or a CUI), for an account that holds several."),
};

export const saveDir = z
  .string()
  .default("")
  .describe("A folder INSIDE the downloads outbox (e.g. \"2026-10\"); empty means the outbox itself. A path outside it is refused.");
