import { DECIMAL_TEXT } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { RATE_RULES, ROUNDINGS } from "../domain/convert.js";

/**
 * What each tool answers, as MCP output schemas: a client gets the result as
 * typed structured content beside the JSON text, and the guard fails a result
 * that does not match (packages/mcp-kit, serve/guard.ts). Rates are BNR's exact
 * text, never numbers. The controllers declare their results as these types
 * (the kit's OutputOf), so a use case that stops filling a field fails the
 * typecheck.
 */

const rateText = z.string().regex(DECIMAL_TEXT).describe("BNR's exact text, RON per `multiplier` units");
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
  date: isoDate,
  rate: rateText,
  multiplier: z.number().int(),
  published_on: isoDate.describe("The date of the fixing this rate is"),
  meaning: z.string(),
  note: z.string().optional(),
  source: z.string(),
});

export const ANNUAL_OUTPUT = z.strictObject({
  ok: z.literal(true),
  currency: z.string(),
  year: z.number().int(),
  average: rateText,
  multiplier: z.number().int(),
  warning: z.string().optional(),
  complete: z.boolean(),
  note: z.string().optional(),
  method: z.string(),
  months: z.array(z.strictObject({ month: z.string().regex(/^\d{4}-\d{2}$/), average: rateText, days: z.number().int() })),
  source: z.string(),
});

export const CONVERT_OUTPUT = z.strictObject({
  ok: z.literal(true),
  amount: z.string().regex(DECIMAL_TEXT).describe("The amount converted, as given"),
  from: z.string(),
  to: z.string(),
  result: z.string().regex(/^-?\d+(\.\d+)?$/).describe("The converted amount, computed exactly and rounded once"),
  date: isoDate,
  rate_rule: z.enum(RATE_RULES),
  rate: rateText,
  multiplier: z.number().int(),
  published_on: isoDate.describe("The date of the fixing the conversion used"),
  rounding: z.enum(ROUNDINGS),
  places: z.number().int(),
  meaning: z.string(),
  note: z.string().optional(),
  source: z.string(),
});

const series = z.strictObject({
  currency: z.string(),
  multiplier: z.number().int(),
  fixings: z.array(z.strictObject({ date: isoDate.describe("The fixing's date"), rate: rateText })),
});

export const RATES_OUTPUT = z.strictObject({
  ok: z.literal(true),
  date: isoDate.optional().describe("The day asked for: each series holds the rate in force on it"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  series: z.array(series).describe("One per currency, or per currency and multiplier if BNR changed it within the window"),
  count: z.number().int().describe("How many rates the series hold"),
  absent: z.array(z.string()).optional().describe("Currencies asked for that BNR published no fixing of in the window"),
  note: z.string().optional(),
  source: z.string(),
});
