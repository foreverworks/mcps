/**
 * The server as a client sees it, through the kit's guard, against a fake
 * curs.bnr.ro: BNR's real 2022 file (trimmed to three currencies; public
 * data), small invented files for the other years, and the HTML page the old
 * www.bnr.ro addresses answer with. No network.
 */
import { readFileSync } from "node:fs";

import { checkPolicy, connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

const Y2022 = readFileSync(new URL("./fixtures/nbrfxrates2022.xml", import.meta.url), "utf8");

const doc = (cubes: Readonly<Record<string, string>>) =>
  `<?xml version="1.0" encoding="utf-8"?><DataSet xmlns="https://www.bnr.ro/xsd"><Header><Publisher>National Bank of Romania</Publisher><PublishingDate>2026-10-16</PublishingDate></Header><Body><OrigCurrency>RON</OrigCurrency>` +
  Object.entries(cubes)
    .map(([date, rates]) => `<Cube date="${date}">${rates}</Cube>`)
    .join("") +
  "</Body></DataSet>";

const Y2023 = doc({ "2023-01-03": '<Rate currency="USD">4.6402</Rate>', "2023-01-04": '<Rate currency="USD">4.6520</Rate>' });
const Y2026 = doc({
  "2026-01-05": '<Rate currency="USD">4.2440</Rate><Rate currency="EUR">5.0900</Rate>',
  "2026-10-15": '<Rate currency="USD">4.3700</Rate><Rate currency="EUR">5.0905</Rate>',
  "2026-10-16": '<Rate currency="USD">4.3712</Rate><Rate currency="EUR">5.0910</Rate>',
});
const HOME = "<!doctype html><html lang=\"ro\"><head><title>BNR Banca Națională a României (BNR)</title></head><body></body></html>";

const FILES: Readonly<Record<string, { readonly status?: number; readonly text: string; readonly type?: string }>> = {
  "/files/xml/years/nbrfxrates2022.xml": { text: Y2022 },
  "/files/xml/years/nbrfxrates2023.xml": { text: Y2023 },
  "/files/xml/years/nbrfxrates2024.xml": { text: HOME, type: "text/html; charset=UTF-8" },
  "/files/xml/years/nbrfxrates2026.xml": { text: Y2026 },
  "/nbrfxrates.xml": { text: doc({ "2026-10-16": '<Rate currency="USD">4.3712</Rate><Rate currency="EUR">5.0910</Rate>' }) },
};

/** 2026-10-18 08:00 in Bucharest, a Sunday. */
const NOW = Date.UTC(2026, 9, 18, 5, 0, 0);

const connected = async () => {
  const clock = { t: NOW };
  const asked: string[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = new URL(String(input));
    asked.push(url.pathname);
    const file = url.origin === "https://curs.bnr.ro" ? FILES[url.pathname] : undefined;
    if (file === undefined) return new Response("<html><body>Not Found</body></html>", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(file.text, { status: file.status ?? 200, headers: { "content-type": file.type ?? "text/xml" } });
  }) as typeof globalThis.fetch;
  const deps = buildDeps({ fetch, now: () => clock.t, sleep: async () => undefined });
  const server = new McpServer({ name: "bnr", version: "test" });
  registerAll(guard(server, { service: "bnr", policy: POLICY, log: () => undefined }), deps);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return JSON.parse(result.content[0]?.text ?? "{}");
  };
  return { call, client, asked, clock };
};

describe("annual_average", () => {
  it("is the mean of BNR's monthly averages, as BNR publishes it and ANAF uses it: USD 2022 4.6885, EUR 2022 4.9315", async () => {
    const s = await connected();
    const usd = await s.call("annual_average", { currency: "usd", year: 2022 });
    expect(usd).toMatchObject({ ok: true, currency: "USD", year: 2022, average: "4.6885", multiplier: 1, complete: true });
    expect(usd.months).toHaveLength(12);
    expect(usd.months[0]).toEqual({ month: "2022-01", average: "4.3681", days: 20 });
    expect(usd.months.map((m: { average: string }) => m.average)).toEqual([
      "4.3681", "4.3610", "4.4909", "4.5638", "4.6776", "4.6756", "4.8507", "4.8344", "4.9531", "5.0140", "4.8248", "4.6477",
    ]);
    expect((await s.call("annual_average", { currency: "EUR", year: 2022 })).average).toBe("4.9315");
    expect(await s.call("annual_average", { currency: "HUF", year: 2022 })).toMatchObject({ multiplier: 100 });
    expect(s.asked.filter((p) => p.endsWith("2022.xml"))).toHaveLength(1);
  });

  it("answers a year not over yet with the months so far, and refuses what BNR cannot have", async () => {
    const s = await connected();
    const partial = await s.call("annual_average", { currency: "USD", year: 2026 });
    expect(partial).toMatchObject({ average: "4.3073", complete: false, months: [{ month: "2026-01", average: "4.2440", days: 1 }, { month: "2026-10", average: "4.3706", days: 2 }] });
    expect(partial.note).toContain("2 month(s) so far");
    expect((await s.call("annual_average", { currency: "USD", year: 2027 })).error).toMatchObject({ kind: "input" });
    expect((await s.call("annual_average", { currency: "ABC", year: 2022 })).error).toMatchObject({ kind: "not_found", message: expect.stringContaining("EUR, HUF, USD") });
  });
});

describe("rate", () => {
  it("is the fixing of the day, or of the last banking day before it, with the date BNR published it, as BNR wrote it", async () => {
    const s = await connected();
    expect(await s.call("rate", { currency: "USD", date: "2022-12-30" })).toMatchObject({ rate: "4.6346", multiplier: 1, published_on: "2022-12-30" });
    expect(await s.call("rate", { currency: "USD", date: "2022-12-31" })).toMatchObject({ date: "2022-12-31", rate: "4.6346", published_on: "2022-12-30" });
    // New Year's Day takes the last fixing of the year before.
    expect(await s.call("rate", { currency: "USD", date: "2023-01-01" })).toMatchObject({ rate: "4.6346", published_on: "2022-12-30" });
    expect(await s.call("rate", { currency: "USD", date: "2026-01-05" })).toMatchObject({ rate: "4.2440", published_on: "2026-01-05" });
    expect(await s.call("rate", { currency: "HUF", date: "2022-12-30" })).toMatchObject({ rate: "1.2354", multiplier: 100, meaning: expect.stringContaining("RON for 100 HUF") });
  });

  it("answers typed structured content beside the text, the same JSON, for every tool", async () => {
    const s = await connected();
    for (const [name, args] of [
      ["rate", { currency: "EUR", date: "2026-10-16" }],
      ["annual_average", { currency: "USD", year: 2022 }],
      ["health", {}],
      ["convert", { amount: "100", from: "EUR", to: "RON", date: "2026-10-16" }],
      ["rates", { currencies: ["USD"], from: "2022-12-29", to: "2023-01-04" }],
      ["rates", {}],
    ] as const) {
      const result = (await s.client.callTool({ name, arguments: args })) as unknown as { content: [{ text: string }]; structuredContent?: unknown; isError?: boolean };
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(JSON.parse(result.content[0].text));
    }
    const failed = await s.client.callTool({ name: "rate", arguments: { currency: "XYZ", date: "2026-10-16" } });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toBeUndefined();
  });

  it("defaults to today in Bucharest and says when the day's fixing is not out", async () => {
    const s = await connected();
    const today = await s.call("rate", { currency: "EUR" });
    expect(today).toMatchObject({ date: "2026-10-18", rate: "5.0910", published_on: "2026-10-16" });
    expect(today.note).toContain("around 13:00");
  });

  it("refuses a future date, a code that is not one, and a currency BNR does not publish", async () => {
    const s = await connected();
    expect((await s.call("rate", { currency: "USD", date: "2026-10-19" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("after today") });
    expect(((await s.client.callTool({ name: "rate", arguments: { currency: "US" } })) as { isError?: boolean }).isError).toBe(true);
    expect((await s.call("rate", { currency: "U$D", date: "2022-12-30" })).error).toMatchObject({ kind: "input" });
    expect((await s.call("rate", { currency: "XYZ", date: "2022-12-30" })).error).toMatchObject({ kind: "not_found" });
  });
});

describe("convert", () => {
  it("converts to RON at the rate in force, rounded once, and shows the rate and the date BNR published it", async () => {
    const s = await connected();
    expect(await s.call("convert", { amount: "100", from: "eur", to: "RON", date: "2026-10-16" })).toMatchObject({
      ok: true,
      amount: "100",
      from: "EUR",
      to: "RON",
      result: "509.10",
      rate: "5.0910",
      multiplier: 1,
      published_on: "2026-10-16",
      rate_rule: "in_force",
      rounding: "half-up",
      places: 2,
      meaning: "100 EUR = 509.10 RON at BNR's EUR rate 5.0910 RON for 1 EUR, published on 2026-10-16 (in force on 2026-10-16), rounded half-up to 2 places",
    });
    // A Saturday takes Friday's fixing.
    expect(await s.call("convert", { amount: "100", from: "EUR", to: "RON", date: "2026-10-17" })).toMatchObject({ result: "509.10", published_on: "2026-10-16" });
    // HUF is quoted per 100.
    expect(await s.call("convert", { amount: "10000", from: "HUF", to: "RON", date: "2022-12-30" })).toMatchObject({ result: "123.54", rate: "1.2354", multiplier: 100 });
  });

  it("takes the last rate strictly before the day when asked, across the new year too", async () => {
    const s = await connected();
    expect(await s.call("convert", { amount: "100", from: "EUR", to: "RON", date: "2026-10-16", rate_rule: "last_before" })).toMatchObject({
      result: "509.05",
      rate: "5.0905",
      published_on: "2026-10-15",
      meaning: expect.stringContaining("(the last before 2026-10-16)"),
    });
    expect(await s.call("convert", { amount: "1", from: "USD", to: "RON", date: "2023-01-03", rate_rule: "last_before" })).toMatchObject({ result: "4.63", published_on: "2022-12-30" });
  });

  it("converts out of RON and rounds by the rule named, never through a float", async () => {
    const s = await connected();
    expect(await s.call("convert", { amount: "1000", from: "RON", to: "USD", date: "2026-10-16" })).toMatchObject({ result: "228.77", rate: "4.3712" });
    expect(await s.call("convert", { amount: "1000", from: "RON", to: "USD", date: "2026-10-16", places: 6 })).toMatchObject({ result: "228.770132" });
    expect(await s.call("convert", { amount: "10000", from: "RON", to: "HUF", date: "2022-12-30", places: 0 })).toMatchObject({ result: "809454" });
    // 1.5 x 5.0910 = 7.6365 exactly: the two rules part at three places.
    expect(await s.call("convert", { amount: "1.5", from: "EUR", to: "RON", date: "2026-10-16", places: 3 })).toMatchObject({ result: "7.637" });
    expect(await s.call("convert", { amount: "1.5", from: "EUR", to: "RON", date: "2026-10-16", places: 3, rounding: "half-even" })).toMatchObject({ result: "7.636" });
    expect(await s.call("convert", { amount: "-1.5", from: "EUR", to: "RON", date: "2026-10-16", places: 3 })).toMatchObject({ result: "-7.637" });
    expect(await s.call("convert", { amount: "123456789012345.12345678", from: "EUR", to: "RON", date: "2026-10-16", places: 8 })).toMatchObject({
      result: "628518512861849.02351847",
    });
  });

  it("says when today's fixing is not out, and refuses what it cannot convert", async () => {
    const s = await connected();
    expect((await s.call("convert", { amount: "1", from: "EUR", to: "RON" })).note).toContain("around 13:00");
    expect((await s.call("convert", { amount: "1", from: "EUR", to: "USD", date: "2026-10-16" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("one side is RON") });
    expect((await s.call("convert", { amount: "1", from: "RON", to: "ron" })).error).toMatchObject({ kind: "input" });
    expect((await s.call("convert", { amount: "1", from: "XYZ", to: "RON", date: "2026-10-16" })).error).toMatchObject({ kind: "not_found" });
    for (const amount of ["1,5", "1e3", "", " ", "1.123456789"]) {
      expect(((await s.client.callTool({ name: "convert", arguments: { amount, from: "EUR", to: "RON" } })) as { isError?: boolean }).isError).toBe(true);
    }
    expect(((await s.client.callTool({ name: "convert", arguments: { amount: 1.5, from: "EUR", to: "RON" } })) as { isError?: boolean }).isError).toBe(true);
    expect(((await s.client.callTool({ name: "convert", arguments: { amount: "1", from: "EUR", to: "RON", places: 9 } })) as { isError?: boolean }).isError).toBe(true);
  });
});

describe("rates", () => {
  it("answers every fixing in a window, oldest first, across a new year, as BNR wrote them", async () => {
    const s = await connected();
    expect(await s.call("rates", { currencies: ["usd", "EUR"], from: "2022-12-29", to: "2023-01-04" })).toEqual({
      ok: true,
      from: "2022-12-29",
      to: "2023-01-04",
      series: [
        { currency: "USD", multiplier: 1, fixings: [{ date: "2022-12-29", rate: "4.6501" }, { date: "2022-12-30", rate: "4.6346" }, { date: "2023-01-03", rate: "4.6402" }, { date: "2023-01-04", rate: "4.6520" }] },
        { currency: "EUR", multiplier: 1, fixings: [{ date: "2022-12-29", rate: "4.9458" }, { date: "2022-12-30", rate: "4.9474" }] },
      ],
      count: 6,
      source: "https://curs.bnr.ro/",
    });
    const all = await s.call("rates", { from: "2022-12-28", to: "2022-12-30" });
    expect(all.series.map((x: { currency: string }) => x.currency)).toEqual(["EUR", "HUF", "USD"]);
    expect(all.series[1]).toMatchObject({ multiplier: 100, fixings: [{ date: "2022-12-28", rate: "1.2277" }, { date: "2022-12-29", rate: "1.2288" }, { date: "2022-12-30", rate: "1.2354" }] });
    expect(all.count).toBe(9);
  });

  it("answers several currencies' rates in force on one day, each with the date of its fixing", async () => {
    const s = await connected();
    expect(await s.call("rates", { date: "2022-12-31" })).toMatchObject({
      date: "2022-12-31",
      series: [
        { currency: "EUR", multiplier: 1, fixings: [{ date: "2022-12-30", rate: "4.9474" }] },
        { currency: "HUF", multiplier: 100, fixings: [{ date: "2022-12-30", rate: "1.2354" }] },
        { currency: "USD", multiplier: 1, fixings: [{ date: "2022-12-30", rate: "4.6346" }] },
      ],
      count: 3,
    });
    expect(await s.call("rates", { currencies: ["USD"], date: "2023-01-01" })).toMatchObject({ series: [{ currency: "USD", fixings: [{ date: "2022-12-30", rate: "4.6346" }] }] });
    const today = await s.call("rates", { currencies: ["EUR", "USD"] });
    expect(today).toMatchObject({ date: "2026-10-18", count: 2, series: [{ fixings: [{ date: "2026-10-16", rate: "5.0910" }] }, { fixings: [{ date: "2026-10-16", rate: "4.3712" }] }] });
    expect(today.note).toContain("around 13:00");
  });

  it("says when a window holds no fixing, and which currencies it holds none of", async () => {
    const s = await connected();
    expect(await s.call("rates", { from: "2026-10-17", to: "2026-10-18" })).toMatchObject({ series: [], count: 0, note: expect.stringContaining("no fixing") });
    expect(await s.call("rates", { currencies: ["USD", "EUR"], from: "2022-12-31", to: "2023-01-04" })).toMatchObject({ count: 2, absent: ["EUR"] });
  });

  it("refuses a currency BNR does not publish, a window too long or backwards, and date with a window", async () => {
    const s = await connected();
    expect((await s.call("rates", { currencies: ["XYZ"], from: "2022-12-01", to: "2022-12-30" })).error).toMatchObject({ kind: "not_found", message: expect.stringContaining("XYZ") });
    expect((await s.call("rates", { currencies: ["XYZ"], date: "2022-12-30" })).error).toMatchObject({ kind: "not_found" });
    expect((await s.call("rates", { from: "2022-01-01", to: "2023-01-02" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("at most 366 days") });
    expect((await s.call("rates", { from: "2022-12-30", to: "2022-12-01" })).error).toMatchObject({ kind: "input" });
    expect((await s.call("rates", { from: "2022-12-01", date: "2022-12-30" })).error).toMatchObject({ kind: "input" });
    expect((await s.call("rates", { to: "2022-12-30" })).error).toMatchObject({ kind: "input" });
    expect((await s.call("rates", { from: "2026-10-01", to: "2026-10-19" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("after today") });
  });
});

describe("BNR's files", () => {
  it("calls an HTML page where the XML should be drift, never an empty year", async () => {
    const s = await connected();
    expect((await s.call("rate", { currency: "USD", date: "2024-06-03" })).error).toMatchObject({ kind: "drift", message: expect.stringContaining("HTML page") });
    expect((await s.call("annual_average", { currency: "USD", year: 2025 })).error).toMatchObject({ kind: "not_found", message: expect.stringContaining("2025") });
  });

  it("keeps a past year for good and reads the current one again after ten minutes", async () => {
    const s = await connected();
    await s.call("rate", { currency: "USD", date: "2022-06-01" });
    await s.call("rate", { currency: "USD", date: "2026-10-16" });
    s.clock.t += 11 * 60_000;
    await s.call("rate", { currency: "USD", date: "2022-06-02" });
    await s.call("rate", { currency: "USD", date: "2026-10-16" });
    expect(s.asked.filter((p) => p.endsWith("2022.xml"))).toHaveLength(1);
    expect(s.asked.filter((p) => p.endsWith("2026.xml"))).toHaveLength(2);
  });

  it("reads a year again once it is over, so a file first read while the year was current does not serve a stale average", async () => {
    const s = await connected();
    expect(await s.call("annual_average", { currency: "USD", year: 2026 })).toMatchObject({ complete: false });
    // 2027-01-10: the 2026 file is final now, and what was cached in October was not.
    s.clock.t = Date.UTC(2027, 0, 10, 10, 0, 0);
    await s.call("annual_average", { currency: "USD", year: 2026 });
    await s.call("annual_average", { currency: "USD", year: 2026 });
    expect(s.asked.filter((p) => p.endsWith("2026.xml"))).toHaveLength(2);
  });

  it("in early January, before BNR publishes the new year's file, takes December's last fixing", async () => {
    const s = await connected();
    // 2027-01-02 in Bucharest: no 2027 file yet (the fake answers 404), so today's rate is 2026's last.
    s.clock.t = Date.UTC(2027, 0, 2, 10, 0, 0);
    expect(await s.call("rate", { currency: "USD" })).toMatchObject({ ok: true, rate: "4.3712", published_on: "2026-10-16" });
    expect(await s.call("convert", { amount: "10", from: "EUR", to: "RON" })).toMatchObject({ ok: true });
    // A past year's missing file is still an answer of its own.
    expect((await s.call("annual_average", { currency: "USD", year: 2025 })).error).toMatchObject({ kind: "not_found" });
  });

  it("health reads the latest fixing", async () => {
    const s = await connected();
    expect(await s.call("health")).toMatchObject({ ok: true, latest_fixing: "2026-10-16", currencies: 2, today: "2026-10-18" });
  });
});

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot, every one classified", async () => {
    const s = await connected();
    const { tools } = await s.client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
    expect(() => checkPolicy("bnr", (server) => registerAll(server, buildDeps()), POLICY)).not.toThrow();
  });
});
