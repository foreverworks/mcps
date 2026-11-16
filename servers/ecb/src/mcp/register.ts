import { DECIMAL_TEXT, isIsoDate, type McpServer, type OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { convert } from "../app/usecases/convert.js";
import { health, rate } from "../app/usecases/rates.js";
import { MAX_RATES, rates } from "../app/usecases/series.js";
import { DEFAULT_PLACES, ROUNDINGS } from "../domain/convert.js";
import { handled } from "./envelope.js";
import { CONVERT_OUTPUT, HEALTH_OUTPUT, RATE_OUTPUT, RATES_OUTPUT } from "./outputs.js";

const currency = z.string().trim().min(3).max(3).describe("ISO 4217 code: USD, GBP, JPY, CHF, ...; EUR where the tool allows it; case ignored.");
const day = z.string().trim().refine(isIsoDate, { message: "a calendar date, YYYY-MM-DD" });

/** The whole tool surface. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description: "Whether the ECB's reference rates can be read now: the date of its latest fixing and how many currencies it carries against the euro.",
      inputSchema: {},
      outputSchema: HEALTH_OUTPUT,
    },
    handled((): Promise<OutputOf<typeof HEALTH_OUTPUT>> => health(deps)),
  );

  server.registerTool(
    "rate",
    {
      title: "ECB rate on a day",
      description:
        "The European Central Bank's euro foreign exchange reference rate in force on a day: units of the currency per 1 EUR, as the exact value the ECB " +
        "published (1 EUR = 1.1052 USD), with fixing_date, the date of the fixing it is. The ECB fixes rates on TARGET working days around 16:00 CET; a " +
        "weekend, a TARGET holiday, or today before 16:00 CET takes the last working day's fixing, so the answer always says which one it used. " +
        "Covers every day since 1999-01-04, including currencies the ECB has since dropped (HRK, RUB, BGN, ...) on the days it published them.",
      inputSchema: {
        currency,
        date: day.optional().describe("The day, YYYY-MM-DD in Frankfurt; default today."),
      },
      outputSchema: RATE_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof RATE_OUTPUT>> => rate(deps, { currency: a.currency, date: a.date })),
  );

  server.registerTool(
    "convert",
    {
      title: "Convert between currencies at the ECB rate",
      description:
        "An amount converted between any two currencies the ECB lists, at its fixing in force on a day, computed exactly and rounded once. The euro to a " +
        "currency is amount x rate, a currency to the euro is amount / rate, and two currencies go through the euro as amount x rate(to) / rate(from), " +
        "both rates from the same fixing; no rate is rounded on the way. Answers the result with the rate or rates used and the fixing's date, and a " +
        "sentence stating the rule, so the conversion can be quoted and checked. The ECB's rates are reference rates, not rates a bank or card " +
        "will give.",
      inputSchema: {
        amount: z.string().trim().regex(DECIMAL_TEXT, "a plain decimal with a point, like 1250.50").describe('The amount, as a decimal string: "1250.50", "-75". Never a number.'),
        from: currency.describe("The amount's currency, or EUR. ISO 4217; case ignored."),
        to: currency.describe("The currency wanted, or EUR. ISO 4217; case ignored."),
        date: day.optional().describe("The day of the conversion, YYYY-MM-DD in Frankfurt (an invoice's date, a payment's); default today."),
        rounding: z.enum(ROUNDINGS).default("half-up").describe("How the result is rounded, once: half-up (halves away from zero, as invoices round) or half-even (banker's)."),
        places: z.number().int().min(0).max(8).default(DEFAULT_PLACES).describe("Digits after the point in the result."),
      },
      outputSchema: CONVERT_OUTPUT,
    },
    handled(
      (a): Promise<OutputOf<typeof CONVERT_OUTPUT>> =>
        convert(deps, { amount: a.amount, from: a.from, to: a.to, date: a.date, rounding: a.rounding, places: a.places }),
    ),
  );

  server.registerTool(
    "rates",
    {
      title: "ECB rates: every currency on a day, or a window",
      description:
        "The ECB's reference rates as fixings, oldest first, each currency in units per 1 EUR as the ECB published it. With date (default today): " +
        "every currency's rate in force that day, all from one fixing, whose date the answer gives. With from (and to, default today): every fixing " +
        `the ECB published in the window, as many as fit in ${MAX_RATES} rates a call (a year of seven currencies, or all of them for about three months). ` +
        "Name currencies to narrow either; leave them out for all. Use it for a chart, an average or a check across several days.",
      inputSchema: {
        currencies: z.array(currency).min(1).max(50).optional().describe('ISO 4217 codes, e.g. ["USD", "GBP"], without EUR; default every currency the ECB published.'),
        date: day.optional().describe("One day, YYYY-MM-DD in Frankfurt: the rates in force on it. Not with from."),
        from: day.optional().describe("A window's first day, YYYY-MM-DD: every fixing from it to `to`."),
        to: day.optional().describe("A window's last day, included; default today. Only with from."),
      },
      outputSchema: RATES_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof RATES_OUTPUT>> => rates(deps, { currencies: a.currencies, date: a.date, from: a.from, to: a.to })),
  );
};
