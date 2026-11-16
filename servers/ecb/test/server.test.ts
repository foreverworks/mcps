/**
 * The server as a client sees it, through the kit's guard, against a fake
 * ECB: three real files of reference rates (eurofxref-daily.xml whole;
 * eurofxref-hist-90d.xml and eurofxref-hist.xml cut down to the working days
 * these tests need, each day's fixing as the ECB wrote it) and the HTML page a
 * blocked or moved address answers with. No network.
 */
import { readFileSync } from "node:fs";
import { request } from "node:http";

import { checkPolicy, connectInMemory, guard, MCP_PATH, McpServer, serve } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

type File = { readonly status?: number; readonly text: string; readonly type?: string };

/**
 * The ECB's three files. The history is cut as a day-old copy would be: its
 * newest fixing is 2026-11-12, and 2026-11-13 is in the two small files only.
 */
const FILES: Readonly<Record<string, File>> = {
  "/stats/eurofxref/eurofxref-daily.xml": { text: fixture("eurofxref-daily.xml") },
  "/stats/eurofxref/eurofxref-hist-90d.xml": { text: fixture("eurofxref-hist-90d.xml") },
  "/stats/eurofxref/eurofxref-hist.xml": { text: fixture("eurofxref-hist.xml") },
};
const HOME = '<!doctype html><html lang="en"><head><title>European Central Bank</title></head><body></body></html>';

/** 2026-11-16 06:00 in Frankfurt, a Monday: the latest fixing is Friday 2026-11-13's, and today's is not out. */
const NOW = Date.UTC(2026, 10, 16, 5, 0, 0);

const DAILY = "/stats/eurofxref/eurofxref-daily.xml";
const RECENT = "/stats/eurofxref/eurofxref-hist-90d.xml";
const HISTORY = "/stats/eurofxref/eurofxref-hist.xml";

/** www.ecb.europa.eu, answering `files`; each path asked is pushed to `asked`. */
const fakeEcb = (asked: string[], files: Readonly<Record<string, File>>): typeof globalThis.fetch =>
  (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = new URL(String(input));
    asked.push(url.pathname);
    const file = url.origin === "https://www.ecb.europa.eu" ? files[url.pathname] : undefined;
    if (file === undefined) return new Response("<html><body>Not Found</body></html>", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(file.text, { status: file.status ?? 200, headers: { "content-type": file.type ?? "text/xml" } });
  }) as typeof globalThis.fetch;

const connected = async (files: Readonly<Record<string, File>> = FILES) => {
  const clock = { t: NOW };
  const asked: string[] = [];
  const deps = buildDeps({ fetch: fakeEcb(asked, files), now: () => clock.t, sleep: async () => undefined });
  const server = new McpServer({ name: "ecb", version: "test" });
  registerAll(guard(server, { service: "ecb", policy: POLICY, log: () => undefined }), deps);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return JSON.parse(result.content[0]?.text ?? "{}");
  };
  const refused = async (name: string, args: Record<string, unknown>): Promise<boolean> => ((await client.callTool({ name, arguments: args })) as { isError?: boolean }).isError === true;
  return { call, client, asked, clock, refused };
};

describe("rate", () => {
  it("is the fixing of the day, or of the last working day before it, with the date the ECB published it", async () => {
    const s = await connected();
    expect(await s.call("rate", { currency: "USD", date: "2026-11-13" })).toMatchObject({ ok: true, currency: "USD", date: "2026-11-13", rate: "1.1052", fixing_date: "2026-11-13" });
    expect(await s.call("rate", { currency: "usd", date: "2026-11-11" })).toMatchObject({ rate: "1.1127", fixing_date: "2026-11-11" });
    // A Saturday, a Sunday and a day with no fixing at all take Friday's.
    expect(await s.call("rate", { currency: "USD", date: "2026-11-14" })).toMatchObject({ date: "2026-11-14", rate: "1.1052", fixing_date: "2026-11-13" });
    expect(await s.call("rate", { currency: "USD", date: "2026-11-15" })).toMatchObject({ rate: "1.1052", fixing_date: "2026-11-13" });
    expect(await s.call("rate", { currency: "USD", date: "2026-11-03" })).toMatchObject({ rate: "1.1216", fixing_date: "2026-11-02" });
    const friday = await s.call("rate", { currency: "GBP", date: "2026-11-13" });
    expect(friday.meaning).toBe("1 EUR = 0.83559 GBP, the ECB's euro foreign exchange reference rate of 2026-11-13");
    const saturday = await s.call("rate", { currency: "GBP", date: "2026-11-14" });
    expect(saturday.meaning).toBe("1 EUR = 0.83559 GBP, the ECB's euro foreign exchange reference rate of 2026-11-13, the last fixing before 2026-11-14");
  });

  it("goes back to 1999 through the history, over a TARGET holiday and a new year, and to the ECB's first day", async () => {
    const s = await connected();
    // Easter Monday 2026 has no fixing: Thursday before Good Friday's is the last.
    expect(await s.call("rate", { currency: "USD", date: "2026-04-06" })).toMatchObject({ rate: "1.1525", fixing_date: "2026-04-02" });
    expect(await s.call("rate", { currency: "USD", date: "2026-01-01" })).toMatchObject({ rate: "1.175", fixing_date: "2025-12-31" });
    expect(await s.call("rate", { currency: "ROL", date: "1999-01-04" })).toMatchObject({ rate: "13111", fixing_date: "1999-01-04" });
    expect(await s.call("rate", { currency: "USD", date: "1999-01-10" })).toMatchObject({ fixing_date: "1999-01-08" });
    expect((await s.call("rate", { currency: "USD", date: "1999-01-03" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("start on 1999-01-04") });
  });

  it("answers a currency the ECB dropped on the days it published it, and says what a later fixing carries instead", async () => {
    const s = await connected();
    expect(await s.call("rate", { currency: "HRK", date: "2022-12-30" })).toMatchObject({ rate: "7.5365", fixing_date: "2022-12-30" });
    expect(await s.call("rate", { currency: "RUB", date: "2022-03-01" })).toMatchObject({ rate: "117.201" });
    expect(await s.call("rate", { currency: "BGN", date: "2025-12-31" })).toMatchObject({ rate: "1.9558" });
    // The fixing in force after the last one carries no such rate: no older rate stands in for it.
    for (const [currency, date] of [["HRK", "2023-01-03"], ["RUB", "2022-03-02"], ["BGN", "2026-01-02"], ["BGN", "2026-11-13"], ["XYZ", "2026-11-13"]] as const) {
      expect((await s.call("rate", { currency, date })).error).toMatchObject({ kind: "not_found", message: expect.stringContaining(`carries no ${currency} rate; it carries `) });
    }
  });

  it("is 1 for the euro itself, so every currency has an answer, and says which fixing is in force", async () => {
    const s = await connected();
    const eur = await s.call("rate", { currency: "EUR", date: "2026-11-14" });
    expect(eur).toMatchObject({ rate: "1", fixing_date: "2026-11-13", meaning: expect.stringContaining("the euro is the base") });
  });

  it("writes a rate alike whichever file it came from: the daily file's 365.60 is the history's 365.6", async () => {
    const s = await connected();
    expect(await s.call("rate", { currency: "HUF" })).toMatchObject({ rate: "365.6", fixing_date: "2026-11-13" });
    expect(await s.call("rate", { currency: "HUF", date: "2026-11-13" })).toMatchObject({ rate: "365.6" });
    expect(await s.call("rate", { currency: "IDR" })).toMatchObject({ rate: "20163.71" });
  });

  it("defaults to today in Frankfurt and says when the day's fixing is not out", async () => {
    const s = await connected();
    const today = await s.call("rate", { currency: "USD" });
    expect(today).toMatchObject({ date: "2026-11-16", rate: "1.1052", fixing_date: "2026-11-13" });
    expect(today.note).toContain("around 16:00 CET");
    expect((await s.call("rate", { currency: "USD", date: "2026-11-13" })).note).toBeUndefined();
    // The day after Frankfurt midnight is tomorrow there, whatever the host's zone: 23:30 UTC on the 16th is 00:30 on the 17th.
    s.clock.t = Date.UTC(2026, 10, 16, 23, 30, 0);
    expect(await s.call("rate", { currency: "USD" })).toMatchObject({ date: "2026-11-17" });
  });

  it("refuses a future date, a code that is not one, and a date that is not a day", async () => {
    const s = await connected();
    expect((await s.call("rate", { currency: "USD", date: "2026-11-17" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("after today") });
    expect(await s.refused("rate", { currency: "US" })).toBe(true);
    expect((await s.call("rate", { currency: "U$D", date: "2026-11-13" })).error).toMatchObject({ kind: "input" });
    expect(await s.refused("rate", { currency: "USD", date: "2026-02-30" })).toBe(true);
    expect(await s.refused("rate", { currency: "USD", date: "13/11/2026" })).toBe(true);
  });

  it("reads only the file it needs: the daily one for today, the 90 days for a recent day, the history for an old one", async () => {
    const today = await connected();
    await today.call("rate", { currency: "USD" });
    expect(today.asked).toEqual([DAILY]);
    const recent = await connected();
    await recent.call("rate", { currency: "USD", date: "2026-11-10" });
    expect(recent.asked).toEqual([DAILY, RECENT]);
    const old = await connected();
    await old.call("rate", { currency: "USD", date: "2022-12-30" });
    expect(old.asked).toEqual([DAILY, RECENT, HISTORY]);
  });
});

describe("convert", () => {
  it("converts the euro to a currency and back, exactly, rounded once, and shows the rate and the fixing", async () => {
    const s = await connected();
    expect(await s.call("convert", { amount: "100", from: "EUR", to: "usd", date: "2026-11-13" })).toEqual({
      ok: true,
      amount: "100",
      from: "EUR",
      to: "USD",
      result: "110.52",
      date: "2026-11-13",
      fixing_date: "2026-11-13",
      rates: [{ currency: "USD", rate: "1.1052" }],
      rounding: "half-up",
      places: 2,
      meaning: "100 EUR = 110.52 USD at the ECB fixing of 2026-11-13: 1 EUR = 1.1052 USD; 100 x 1.1052, rounded half-up to 2 places",
      source: expect.stringContaining("ecb.europa.eu"),
    });
    expect(await s.call("convert", { amount: "100", from: "USD", to: "EUR", date: "2026-11-13" })).toMatchObject({
      result: "90.48",
      rates: [{ currency: "USD", rate: "1.1052" }],
      meaning: "100 USD = 90.48 EUR at the ECB fixing of 2026-11-13: 1 EUR = 1.1052 USD; 100 / 1.1052, rounded half-up to 2 places",
    });
    expect(await s.call("convert", { amount: "10000", from: "HUF", to: "EUR", date: "2026-11-13" })).toMatchObject({ result: "27.35", rates: [{ currency: "HUF", rate: "365.6" }] });
  });

  it("converts between two currencies through the euro, with both rates from one fixing and no rate rounded", async () => {
    const s = await connected();
    expect(await s.call("convert", { amount: "100", from: "GBP", to: "USD", date: "2026-11-13" })).toMatchObject({
      result: "132.27",
      fixing_date: "2026-11-13",
      rates: [{ currency: "GBP", rate: "0.83559" }, { currency: "USD", rate: "1.1052" }],
      meaning:
        "100 GBP = 132.27 USD at the ECB fixing of 2026-11-13: 1 EUR = 0.83559 GBP and 1 EUR = 1.1052 USD; 100 x 1.1052 / 0.83559, a cross rate through the euro, rounded half-up to 2 places",
    });
    // One division, not two: 1250.50 RON x 176.83 / 5.3494 = 41336.58...
    expect(await s.call("convert", { amount: "1250.50", from: "RON", to: "JPY", date: "2026-11-13" })).toMatchObject({ result: "41336.58" });
    expect(await s.call("convert", { amount: "1250.50", from: "RON", to: "JPY", date: "2026-11-13", places: 0 })).toMatchObject({ result: "41337" });
    // The same day's rates whatever the direction: a cross rate and its reverse use the same two numbers.
    expect((await s.call("convert", { amount: "1", from: "USD", to: "GBP", date: "2026-11-13" })).rates).toEqual([{ currency: "USD", rate: "1.1052" }, { currency: "GBP", rate: "0.83559" }]);
  });

  it("takes the last fixing on a day without one, from the history for an old day, and says which", async () => {
    const s = await connected();
    expect(await s.call("convert", { amount: "100", from: "EUR", to: "USD", date: "2026-11-14" })).toMatchObject({
      result: "110.52",
      fixing_date: "2026-11-13",
      meaning: "100 EUR = 110.52 USD at the ECB fixing of 2026-11-13 (the last fixing before 2026-11-14): 1 EUR = 1.1052 USD; 100 x 1.1052, rounded half-up to 2 places",
    });
    expect(await s.call("convert", { amount: "100", from: "EUR", to: "HRK", date: "2022-12-31" })).toMatchObject({ result: "753.65", fixing_date: "2022-12-30", rates: [{ currency: "HRK", rate: "7.5365" }] });
    expect(await s.call("convert", { amount: "1", from: "EUR", to: "USD" })).toMatchObject({ date: "2026-11-16", fixing_date: "2026-11-13", note: expect.stringContaining("around 16:00 CET") });
  });

  it("rounds once by the rule named, never through a float, and keeps places", async () => {
    const s = await connected();
    // 1.5 x 176.83 = 265.245 exactly: the two rules part at two places.
    expect(await s.call("convert", { amount: "1.5", from: "EUR", to: "JPY", date: "2026-11-13" })).toMatchObject({ result: "265.25", rounding: "half-up" });
    expect(await s.call("convert", { amount: "1.5", from: "EUR", to: "JPY", date: "2026-11-13", rounding: "half-even" })).toMatchObject({ result: "265.24", rounding: "half-even" });
    expect(await s.call("convert", { amount: "-1.5", from: "EUR", to: "JPY", date: "2026-11-13" })).toMatchObject({ result: "-265.25" });
    expect(await s.call("convert", { amount: "1", from: "EUR", to: "USD", date: "2026-11-13", places: 6 })).toMatchObject({ result: "1.105200", places: 6 });
    // A double holds 15 or 16 digits; this amount has 23 and comes back exact.
    expect(await s.call("convert", { amount: "123456789012345.12345678", from: "EUR", to: "USD", date: "2026-11-13", places: 8 })).toMatchObject({ result: "136444443216443.83044443" });
  });

  it("refuses what it cannot convert", async () => {
    const s = await connected();
    expect((await s.call("convert", { amount: "1", from: "EUR", to: "eur", date: "2026-11-13" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("nothing to convert") });
    expect((await s.call("convert", { amount: "1", from: "USD", to: "USD", date: "2026-11-13" })).error).toMatchObject({ kind: "input" });
    expect((await s.call("convert", { amount: "1", from: "EUR", to: "XYZ", date: "2026-11-13" })).error).toMatchObject({ kind: "not_found", message: expect.stringContaining("carries no XYZ rate") });
    expect((await s.call("convert", { amount: "1", from: "HRK", to: "USD", date: "2026-11-13" })).error).toMatchObject({ kind: "not_found" });
    expect((await s.call("convert", { amount: "1", from: "USD", to: "EUR", date: "2026-11-17" })).error).toMatchObject({ kind: "input" });
    for (const amount of ["1,5", "1e3", "", " ", "1.123456789", "abc"]) expect(await s.refused("convert", { amount, from: "EUR", to: "USD" })).toBe(true);
    expect(await s.refused("convert", { amount: 1.5, from: "EUR", to: "USD" })).toBe(true);
    expect(await s.refused("convert", { amount: "1", from: "EUR", to: "USD", places: 9 })).toBe(true);
    expect(await s.refused("convert", { amount: "1", from: "EUR", to: "USD", rounding: "up" })).toBe(true);
  });
});

describe("rates", () => {
  it("answers every fixing in a window, oldest first, as the ECB wrote them, across the files", async () => {
    const s = await connected();
    expect(await s.call("rates", { currencies: ["usd", "GBP"], from: "2026-11-09", to: "2026-11-13" })).toEqual({
      ok: true,
      from: "2026-11-09",
      to: "2026-11-13",
      fixings: [
        { date: "2026-11-09", rates: { USD: "1.1193", GBP: "0.8343" } },
        { date: "2026-11-10", rates: { USD: "1.1214", GBP: "0.83545" } },
        { date: "2026-11-11", rates: { USD: "1.1127", GBP: "0.83618" } },
        { date: "2026-11-12", rates: { USD: "1.1081", GBP: "0.83595" } },
        { date: "2026-11-13", rates: { USD: "1.1052", GBP: "0.83559" } },
      ],
      count: 10,
      source: expect.stringContaining("ecb.europa.eu"),
    });
    // A window with no `to` ends today; today has no fixing yet, so it ends on Friday's.
    const open = await s.call("rates", { currencies: ["USD"], from: "2026-11-11" });
    expect(open).toMatchObject({ from: "2026-11-11", to: "2026-11-16", count: 3 });
    expect(open.fixings.at(-1)).toEqual({ date: "2026-11-13", rates: { USD: "1.1052" } });
  });

  it("reaches back past the 90 days and still ends on today's fixing, even when the history was cached before it", async () => {
    const s = await connected();
    // The history fixture ends on 2026-11-12; 2026-11-13 comes from the small files laid over it.
    const window = await s.call("rates", { currencies: ["USD"], from: "2026-01-01", to: "2026-11-13" });
    expect(window.fixings.map((f: { date: string }) => f.date)).toEqual([
      "2026-01-02", "2026-04-02", "2026-08-17", "2026-08-18", "2026-10-30", "2026-11-02", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
    ]);
    expect(window.fixings.at(-1)).toEqual({ date: "2026-11-13", rates: { USD: "1.1052" } });
    expect(window.count).toBe(11);
    expect(s.asked).toEqual([DAILY, RECENT, HISTORY]);
    // 1999: the first week, with the currencies the euro started with.
    const first = await s.call("rates", { from: "1999-01-04", to: "1999-01-05" });
    expect(first.fixings).toHaveLength(2);
    expect(first.fixings[0].rates).toMatchObject({ USD: "1.1789", ROL: "13111", TRL: "372274" });
  });

  it("answers every currency, or those named, as of one day, all from the one fixing in force then", async () => {
    const s = await connected();
    const all = await s.call("rates", { date: "2026-11-14" });
    expect(all).toMatchObject({ ok: true, date: "2026-11-14", fixing_date: "2026-11-13", count: 29 });
    expect(all.fixings).toHaveLength(1);
    expect(all.fixings[0]).toMatchObject({ date: "2026-11-13", rates: { USD: "1.1052", JPY: "176.83", HUF: "365.6", IDR: "20163.71" } });
    expect(await s.call("rates", { currencies: ["CHF", "gbp"], date: "2026-04-06" })).toMatchObject({
      date: "2026-04-06",
      fixing_date: "2026-04-02",
      fixings: [{ date: "2026-04-02", rates: { CHF: "0.9213", GBP: "0.87253" } }],
      count: 2,
    });
    const today = await s.call("rates", { currencies: ["USD"] });
    expect(today).toMatchObject({ date: "2026-11-16", fixing_date: "2026-11-13", count: 1 });
    expect(today.note).toContain("around 16:00 CET");
    expect((await s.call("rates", { currencies: ["USD"], date: "2026-11-13" })).note).toBeUndefined();
    expect((await s.call("rates", { currencies: ["USD", "HRK"], date: "2026-11-13" })).error).toMatchObject({ kind: "not_found", message: expect.stringContaining("carries no HRK rate") });
  });

  it("says when a window holds no fixing, and which currencies it holds none of", async () => {
    const s = await connected();
    expect(await s.call("rates", { from: "2026-11-14", to: "2026-11-15" })).toMatchObject({ fixings: [], count: 0, note: expect.stringContaining("no fixing") });
    // BGN leaves with the euro's arrival in Bulgaria: its last fixing is 2025-12-31, and the next one has none.
    const leaving = await s.call("rates", { currencies: ["USD", "BGN"], from: "2025-12-29", to: "2026-01-05" });
    expect(leaving).toMatchObject({ fixings: [{ date: "2025-12-31", rates: { USD: "1.175", BGN: "1.9558" } }, { date: "2026-01-02", rates: { USD: "1.1721" } }], count: 3 });
    expect(leaving.absent).toBeUndefined();
    const gone = await s.call("rates", { currencies: ["USD", "BGN"], from: "2026-01-01", to: "2026-04-30" });
    expect(gone).toMatchObject({ count: 2, absent: ["BGN"] });
    expect((await s.call("rates", { currencies: ["BGN"], from: "2026-01-01", to: "2026-04-30" })).note).toContain("no BGN rate");
  });

  it("refuses EUR as a currency, a window backwards or with a day, a to without from, and a future day", async () => {
    const s = await connected();
    expect((await s.call("rates", { currencies: ["EUR"], date: "2026-11-13" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("base") });
    expect((await s.call("rates", { from: "2026-11-13", to: "2026-11-09" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("after to") });
    expect((await s.call("rates", { from: "2026-11-09", date: "2026-11-13" })).error).toMatchObject({ kind: "input" });
    expect((await s.call("rates", { to: "2026-11-13" })).error).toMatchObject({ kind: "input" });
    expect((await s.call("rates", { from: "2026-11-09", to: "2026-11-17" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("after today") });
    expect((await s.call("rates", { from: "1998-12-31", to: "1999-01-05" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("start on 1999-01-04") });
    expect(await s.refused("rates", { currencies: [] })).toBe(true);
  });
});

describe("the ECB's files", () => {
  it("calls an HTML page where the XML should be drift, never an empty answer", async () => {
    const s = await connected({ ...FILES, [HISTORY]: { text: HOME, type: "text/html; charset=UTF-8" } });
    expect((await s.call("rate", { currency: "USD", date: "2022-12-30" })).error).toMatchObject({ kind: "drift", message: expect.stringContaining("HTML page") });
    // A day the small files answer does not touch the broken one.
    expect(await s.call("rate", { currency: "USD", date: "2026-11-13" })).toMatchObject({ ok: true });
  });

  it("reports the ECB being down as api after its retries, and a missing file as not found", async () => {
    const down = await connected({ ...FILES, [DAILY]: { status: 503, text: "unavailable" } });
    expect((await down.call("rate", { currency: "USD" })).error).toMatchObject({ kind: "api" });
    expect(down.asked.filter((p) => p === DAILY)).toHaveLength(3);
    const gone = await connected({});
    expect((await gone.call("health")).error).toMatchObject({ kind: "not_found" });
  });

  it("keeps the two small files five minutes and the history a day", async () => {
    const s = await connected();
    await s.call("rate", { currency: "USD", date: "2022-12-30" });
    await s.call("rate", { currency: "USD", date: "2022-12-29" });
    expect(s.asked).toEqual([DAILY, RECENT, HISTORY]);
    s.clock.t += 6 * 60_000;
    await s.call("rate", { currency: "USD", date: "2022-12-28" });
    expect(s.asked).toEqual([DAILY, RECENT, HISTORY, DAILY, RECENT]);
    s.clock.t += 25 * 60 * 60_000;
    await s.call("rate", { currency: "USD", date: "2022-12-28" });
    expect(s.asked.filter((p) => p === HISTORY)).toHaveLength(2);
  });

  it("health reads the latest fixing and warns when it is old", async () => {
    const s = await connected();
    expect(await s.call("health")).toMatchObject({ ok: true, latest_fixing: "2026-11-13", currencies: 29, today: "2026-11-16" });
    expect((await s.call("health")).warning).toBeUndefined();
    // Easter's long weekend is four days between fixings; five days without one is odd.
    s.clock.t = Date.UTC(2026, 10, 18, 10, 0, 0);
    expect((await s.call("health")).warning).toBeUndefined();
    s.clock.t = Date.UTC(2026, 10, 19, 10, 0, 0);
    expect((await s.call("health")).warning).toContain("more than five days ago");
  });
});

describe("the tool surface", () => {
  it("answers typed structured content beside the text, the same JSON, for every tool", async () => {
    const s = await connected();
    for (const [name, args] of [
      ["rate", { currency: "USD", date: "2026-11-13" }],
      ["health", {}],
      ["convert", { amount: "100", from: "GBP", to: "USD", date: "2026-11-13" }],
      ["rates", { currencies: ["USD"], from: "2026-11-09", to: "2026-11-13" }],
      ["rates", { date: "2026-11-14" }],
      ["rates", { from: "2026-11-14", to: "2026-11-15" }],
    ] as const) {
      const result = (await s.client.callTool({ name, arguments: args })) as unknown as { content: [{ text: string }]; structuredContent?: unknown; isError?: boolean };
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(JSON.parse(result.content[0].text));
    }
    const failed = await s.client.callTool({ name: "rate", arguments: { currency: "XYZ", date: "2026-11-13" } });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toBeUndefined();
  });

  it("lists the same tools, arguments and descriptions as the snapshot, every one classified", async () => {
    const s = await connected();
    const { tools } = await s.client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
    expect(() => checkPolicy("ecb", (server) => registerAll(server, buildDeps()), POLICY)).not.toThrow();
  });
});

describe("served publicly, with no sign-in", () => {
  it("starts, since every tool reads, and answers a caller the proxy forwards, with no token", async () => {
    const deps = buildDeps({ fetch: fakeEcb([], FILES), now: () => NOW, sleep: async () => undefined });
    const audit: string[] = [];
    const served = await serve({
      name: "ecb",
      version: "test",
      policy: POLICY,
      register: (server) => registerAll(server, deps),
      env: { MCP_HTTP_PORT: "0", MCP_HTTP_PUBLIC_HOSTS: "rates.example.com", MCP_HTTP_CLIENT_IP_HEADER: "cf-connecting-ip" },
      log: (line) => audit.push(line),
    });
    try {
      // As the proxy forwards it: the public Host, the caller's address in its header, and no Authorization.
      const answer = await new Promise<{ readonly status: number; readonly body: string }>((resolve, reject) => {
        const headers = { host: "rates.example.com", "cf-connecting-ip": "192.0.2.10", "content-type": "application/json", accept: "application/json, text/event-stream" };
        const req = request(`http://127.0.0.1:${served.port}${MCP_PATH}`, { method: "POST", headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "rate", arguments: { currency: "USD", date: "2026-11-14" } } }));
      });
      expect(answer.status).toBe(200);
      const result = (JSON.parse(answer.body) as { result: { content: { text: string }[] } }).result;
      expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({ rate: "1.1052", fixing_date: "2026-11-13" });
      expect(audit.map((line) => JSON.parse(line.replace(/^audit /, "")) as Record<string, unknown>)).toEqual([expect.objectContaining({ tool: "rate", client: "public", outcome: "ok" })]);
    } finally {
      await served.close();
    }
  });
});
