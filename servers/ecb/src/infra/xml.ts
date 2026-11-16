import { isIsoDate } from "@foreverworks/mcp-kit";

import type { RatesDocument } from "../app/ports.js";
import { drift, fail } from "../domain/errors.js";
import { type Fixing, positiveRate } from "../domain/rates.js";

/**
 * The ECB's rates XML (`eurofxref-daily.xml`, `eurofxref-hist-90d.xml`,
 * `eurofxref-hist.xml`), read 2026-11-16:
 *
 *   <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
 *     <gesmes:subject>Reference rates</gesmes:subject> <gesmes:Sender>...</gesmes:Sender>
 *     <Cube> <Cube time="2026-11-13"> <Cube currency="USD" rate="1.1052"/> ... </Cube> ... </Cube>
 *   </gesmes:Envelope>
 *
 * The three files share that shape, but not their style: the daily file is
 * indented, quotes with ' and writes `365.60`; the other two are one line, quote
 * with " and write `365.6`. History lists the newest fixing first. Both quote
 * marks are read, trailing zeros are dropped, and the fixings are returned
 * oldest first. An answer that is not this document (an HTML error or a
 * bot-check page with status 200) is drift, never an empty year. Pure.
 */

const NAMESPACE = /xmlns=["']http:\/\/www\.ecb\.int\/vocabulary\/2002-08-01\/eurofxref["']/;
const FIXING = /<Cube\s+time=(["'])([^"']*)\1\s*>([\s\S]*?)<\/Cube>/g;
const RATE = /<Cube\s+currency=(["'])([A-Z]{3})\1\s+rate=(["'])([^"']*)\3\s*\/>/g;

export const ratesIn = (text: string, what: string): RatesDocument => {
  const head = text.slice(0, 600).toLowerCase();
  if (head.includes("<html") || head.includes("<!doctype html")) fail(drift(`the ECB answered ${what} with an HTML page, not its rates XML`));
  if (!text.slice(0, 1000).includes("gesmes:Envelope") || !NAMESPACE.test(text.slice(0, 1000)))
    fail(drift(`the ECB's answer to ${what} is not its rates XML (no gesmes:Envelope in the eurofxref namespace)`));
  const fixings = [...text.matchAll(FIXING)].map((cube): Fixing => {
    const date = cube[2] ?? "";
    if (!isIsoDate(date)) fail(drift(`the ECB's ${what} has a fixing dated "${date}"`));
    const rates: Record<string, string> = {};
    for (const r of (cube[3] ?? "").matchAll(RATE)) {
      const [, , currency = "", , value = ""] = r;
      rates[currency] = positiveRate(value) ?? fail(drift(`the ECB's ${what} gives ${currency} on ${date} as "${value}"`));
    }
    if (Object.keys(rates).length === 0) fail(drift(`the ECB's ${what} has a fixing on ${date} with no rates`));
    return { date, rates };
  });
  const [first, ...rest] = fixings.sort((a, b) => a.date.localeCompare(b.date));
  if (first === undefined) return fail(drift(`the ECB's ${what} holds no fixings`));
  return { fixings: [first, ...rest] };
};
