import { DECIMAL_TEXT, isIsoDate, type McpServer, type OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { convert } from "../app/usecases/convert.js";
import { annual, health, rate } from "../app/usecases/rates.js";
import { MAX_RATES, MAX_WINDOW_DAYS, rates } from "../app/usecases/series.js";
import { DEFAULT_PLACES, RATE_RULES, ROUNDINGS } from "../domain/convert.js";
import { FIRST_YEAR } from "../domain/dates.js";
import { handled } from "./envelope.js";
import { ANNUAL_OUTPUT, CONVERT_OUTPUT, HEALTH_OUTPUT, RATE_OUTPUT, RATES_OUTPUT } from "./outputs.js";

const currency = z.string().trim().min(3).max(3).describe("ISO 4217 code: EUR, USD, GBP, CHF, ... (XAU gold, XDR SDR); case ignored.");
const day = z.string().trim().refine(isIsoDate, { message: "a calendar date, YYYY-MM-DD" });

/** The whole tool surface. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description: "Whether BNR's rates can be read now: the date of its latest fixing and how many currencies it carries.",
      inputSchema: {},
      outputSchema: HEALTH_OUTPUT,
    },
    handled((): Promise<OutputOf<typeof HEALTH_OUTPUT>> => health(deps)),
  );

  server.registerTool(
    "rate",
    {
      title: "BNR rate on a day",
      description:
        "The National Bank of Romania's reference rate in force on a day: RON per `multiplier` units of the currency (1, or 100 for HUF, JPY, KRW and a " +
        "few others), as the exact text BNR published, with published_on, the date of the fixing it is. A weekend, a holiday, or today before BNR " +
        "publishes (about 13:00 Bucharest) takes the last banking day's fixing. Use it for any EUR/RON or other conversion stated on a date.",
      inputSchema: {
        currency,
        date: day.optional().describe("The day, YYYY-MM-DD in Bucharest; default today."),
      },
      outputSchema: RATE_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof RATE_OUTPUT>> => rate(deps, { currency: a.currency, date: a.date })),
  );

  server.registerTool(
    "annual_average",
    {
      title: "BNR annual average",
      description:
        "BNR's annual average rate for a year, as ANAF converts foreign income in the D212 (\"cursul de schimb mediu anual comunicat de BNR\"): the mean " +
        "of the twelve monthly averages, each the mean of the month's daily rates, to four places, with the monthly values and their day counts. Not " +
        "the mean of the daily rates, which differs. A year not over yet answers the months so far with complete: false.",
      inputSchema: {
        currency,
        year: z.number().int().min(FIRST_YEAR).max(2100).describe("The calendar year, e.g. 2023."),
      },
      outputSchema: ANNUAL_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof ANNUAL_OUTPUT>> => annual(deps, { currency: a.currency, year: a.year })),
  );

  server.registerTool(
    "convert",
    {
      title: "Convert to or from RON",
      description:
        "An amount converted to or from RON at BNR's reference rate, computed exactly and rounded once: to RON is amount x rate / multiplier, from RON " +
        "amount x multiplier / rate. rate_rule picks the fixing: in_force (the day's, or the last banking day's before it, as rate answers) or " +
        "last_before (the last one strictly before the day, the rule for an invoice in a foreign currency). Answers the result with the rate, its " +
        "multiplier and the date BNR published it, so the conversion can be stated. One side must be RON; for two other currencies, convert twice.",
      inputSchema: {
        amount: z.string().trim().regex(DECIMAL_TEXT, "a plain decimal with a point, like 1250.50").describe('The amount, as a decimal string: "1250.50", "-75". Never a number.'),
        from: currency.describe("The amount's currency: RON, or the currency to convert to RON. ISO 4217; case ignored."),
        to: currency.describe("The currency wanted: RON, or the currency to convert RON to. ISO 4217; case ignored."),
        date: day.optional().describe("The day of the conversion, YYYY-MM-DD in Bucharest (an invoice's date, a payment's); default today."),
        rate_rule: z.enum(RATE_RULES).default("in_force").describe("in_force: the rate in force on the day; last_before: the last rate published before the day."),
        rounding: z.enum(ROUNDINGS).default("half-up").describe("How the result is rounded, once: half-up (halves away from zero, as invoices round) or half-even (banker's)."),
        places: z.number().int().min(0).max(8).default(DEFAULT_PLACES).describe("Digits after the point in the result."),
      },
      outputSchema: CONVERT_OUTPUT,
    },
    handled(
      (a): Promise<OutputOf<typeof CONVERT_OUTPUT>> =>
        convert(deps, { amount: a.amount, from: a.from, to: a.to, date: a.date, rateRule: a.rate_rule, rounding: a.rounding, places: a.places }),
    ),
  );

  server.registerTool(
    "rates",
    {
      title: "BNR rates: several currencies, or a window",
      description:
        "BNR's reference rates as series, the exact text BNR published. With date (default today): each currency's rate in force that day, from " +
        "the day's fixing or the last banking day's before it. With from (and to, default today): every fixing BNR published in the window, oldest " +
        `first, at most ${MAX_WINDOW_DAYS} days and ${MAX_RATES} rates a call. Without currencies, every currency BNR published. Each series carries ` +
        "its multiplier (RON per 1, or per 100 for HUF, JPY, KRW and a few others).",
      inputSchema: {
        currencies: z.array(currency).min(1).max(50).optional().describe("ISO 4217 codes, e.g. [\"EUR\", \"USD\"]; default every currency BNR published."),
        date: day.optional().describe("One day, YYYY-MM-DD in Bucharest: the rates in force on it. Not with from."),
        from: day.optional().describe("A window's first day, YYYY-MM-DD: every fixing from it to `to`."),
        to: day.optional().describe("A window's last day, included; default today. Only with from."),
      },
      outputSchema: RATES_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof RATES_OUTPUT>> => rates(deps, { currencies: a.currencies, date: a.date, from: a.from, to: a.to })),
  );
};
