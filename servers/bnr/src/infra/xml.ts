import { DECIMAL_TEXT, isIsoDate } from "@foreverworks/mcp-kit";

import { drift, fail } from "../domain/errors.js";
import type { Fixing, Rate } from "../domain/rates.js";

/**
 * BNR's rates XML (`nbrfxrates.xml`, `nbrfxrates<year>.xml`), read 2026-10-18:
 *
 *   <DataSet xmlns="https://www.bnr.ro/xsd"> <Header> ... <PublishingDate>2026-10-16</PublishingDate> ...
 *   <Body> ... <Cube date="2020-01-03"> <Rate currency="EUR">4.7789</Rate>
 *   <Rate currency="HUF" multiplier="100">1.4501</Rate> ... </Cube> ... </Body></DataSet>
 *
 * The namespace is `https://www.bnr.ro/xsd` in the current files and
 * `http://www.bnr.ro/xsd` in older years' (2020-2025 read). The old
 * www.bnr.ro addresses now answer with the bank's HTML home page and
 * status 200, which silently breaks a reader that only checks the status: an
 * answer that is not this document is drift, never an empty year. Pure.
 */
import type { RatesDocument } from "../app/ports.js";

export type { RatesDocument };

const RATE = /<Rate\s+currency="([A-Z]{3})"(?:\s+multiplier="(\d+)")?\s*>\s*([^<]*?)\s*<\/Rate>/g;

export const ratesIn = (text: string, what: string): RatesDocument => {
  const head = text.slice(0, 600).toLowerCase();
  if (head.includes("<html") || head.includes("<!doctype html")) fail(drift(`BNR answered ${what} with an HTML page, not its rates XML`));
  if (!/<DataSet\b[^>]*xmlns="https?:\/\/www\.bnr\.ro\/xsd"/.test(text)) fail(drift(`BNR's answer to ${what} is not its rates XML (no DataSet in BNR's namespace)`));
  const fixings = [...text.matchAll(/<Cube\s+date="([^"]+)"\s*>([\s\S]*?)<\/Cube>/g)].map((cube): Fixing => {
    const date = cube[1] ?? "";
    if (!isIsoDate(date)) fail(drift(`BNR's ${what} has a fixing dated "${date}"`));
    const rates: Record<string, Rate> = {};
    for (const r of (cube[2] ?? "").matchAll(RATE)) {
      const [, currency = "", multiplier, value = ""] = r;
      if (!DECIMAL_TEXT.test(value)) fail(drift(`BNR's ${what} gives ${currency} on ${date} as "${value}"`));
      rates[currency] = { value, multiplier: multiplier === undefined ? 1 : Number(multiplier) };
    }
    if (Object.keys(rates).length === 0) fail(drift(`BNR's ${what} has a fixing on ${date} with no rates`));
    return { date, rates };
  });
  if (fixings.length === 0) fail(drift(`BNR's ${what} holds no fixings`));
  return { publishedOn: /<PublishingDate>(\d{4}-\d{2}-\d{2})<\/PublishingDate>/.exec(text)?.[1], fixings };
};
