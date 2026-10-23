import { DECIMAL_TEXT } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { fileIdArg } from "../../../editors/mcp/args.js";

/** The inputs Sheets' tools share, worded once. */
export const spreadsheetArg = () => fileIdArg("spreadsheet");

export const sheetArg = () => z.string().default("").describe("The sheet (tab) name, from list_sheets. Empty means the first sheet.");

export const headerRowArg = () => z.number().int().min(1).default(1).describe("The row that names the columns (1-based).");

/** A cell as written: JSON primitives, an ISO date, a "=" formula, or a currency value as read_rows returned it. */
export const cellValueArg = () =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.object({ amount: z.string().regex(DECIMAL_TEXT).describe('An exact decimal string, e.g. "12.50": stored as a number, never through a float you computed.') }),
  ]);

export const rowsArg = () =>
  z
    .array(z.record(z.string(), cellValueArg()))
    .min(1)
    .describe(
      'Objects keyed by the header row\'s names. Numbers and booleans are stored as such, "=..." as a formula, ' +
        '"YYYY-MM-DD" (or with THH:MM) as a date, any other string as text; null clears a cell. A key the header lacks is refused.',
    );
