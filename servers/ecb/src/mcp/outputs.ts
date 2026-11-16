import { DECIMAL_TEXT } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { ROUNDINGS } from "../domain/convert.js";

/**
 * What each tool answers, as MCP output schemas: a client gets the result as
 * typed structured content beside the JSON text, and the guard fails a result
 * that does not match (packages/mcp-kit, serve/guard.ts). Rates are the ECB's
 * exact text, never numbers. The controllers declare their results as these
 * types (the kit's OutputOf), so a use case that stops filling a field fails
 * the typecheck.
 */

const rateText = z.string().regex(DECIMAL_TEXT).describe("The ECB's exact value, units of the currency per 1 EUR");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const HEALTH_OUTPUT = z.strictObject({
  ok: z.literal(true),
  source: z.string(),
  latest_fixing: isoDate.optional(),
  currencies: z.number().int(),
  today: isoDate,
  warning: z.string().optional(),
});

export const RATE_OUTPUT = z.strictObject({
  ok: z.literal(true),
  currency: z.string(),
  date: isoDate.describe("The day asked for"),
  rate: rateText,
  fixing_date: isoDate.describe("The date of the ECB fixing this rate is"),
  meaning: z.string(),
  note: z.string().optional(),
  source: z.string(),
});

export const CONVERT_OUTPUT = z.strictObject({
  ok: z.literal(true),
  amount: z.string().regex(DECIMAL_TEXT).describe("The amount converted, as given"),
  from: z.string(),
  to: z.string(),
  result: z.string().regex(/^-?\d+(\.\d+)?$/).describe("The converted amount, computed exactly and rounded once"),
  date: isoDate.describe("The day asked for"),
  fixing_date: isoDate.describe("The date of the ECB fixing the conversion used"),
  rates: z
    .array(z.strictObject({ currency: z.string(), rate: rateText }))
    .describe("The rate of each non-euro currency in the conversion, units per 1 EUR, from the one fixing: one for a euro conversion, two for a cross rate"),
  rounding: z.enum(ROUNDINGS),
  places: z.number().int(),
  meaning: z.string(),
  note: z.string().optional(),
  source: z.string(),
});

const fixing = z.strictObject({
  date: isoDate.describe("The fixing's date"),
  rates: z.record(z.string(), rateText).describe("Units of each currency per 1 EUR on that fixing"),
});

export const RATES_OUTPUT = z.strictObject({
  ok: z.literal(true),
  date: isoDate.optional().describe("The day asked for: fixings holds the one in force on it"),
  fixing_date: isoDate.optional().describe("With date: the date of the fixing that was in force"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  fixings: z.array(fixing).describe("Oldest first; a currency the ECB did not publish on a fixing is missing from that fixing's rates"),
  count: z.number().int().describe("How many rates the fixings hold"),
  absent: z.array(z.string()).optional().describe("Currencies asked for that the ECB published no rate of in the window"),
  note: z.string().optional(),
  source: z.string(),
});
