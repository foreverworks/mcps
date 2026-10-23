import { addDays, formatDecimal, toDecimal } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { rates } from "../src/app/usecases/series.js";
import { converted } from "../src/domain/convert.js";
import { annualAverage, fixingOn, inForce, mean, monthlyAverages, seriesOf } from "../src/domain/rates.js";
import { ratesIn } from "../src/infra/xml.js";

const fixing = (date: string, value: string, multiplier = 1) => ({ date, rates: { USD: { value, multiplier } } });

describe("averages", () => {
  it("round once, half up, to four places, and keep the trailing zeros", () => {
    expect(mean(["4.0000", "4.0001"].map(toDecimal))).toEqual(toDecimal("4.0001"));
    expect(mean(["4.0000", "4.0000", "4.0001"].map(toDecimal))).toEqual(toDecimal("4.0000"));
    const months = monthlyAverages([fixing("2026-01-05", "4.2440"), fixing("2026-02-02", "4.2441"), fixing("2026-02-03", "4.2442")], "USD");
    expect(months).toEqual([
      { month: "2026-01", average: "4.2440", days: 1, multiplier: 1 },
      { month: "2026-02", average: "4.2442", days: 2, multiplier: 1 },
    ]);
    expect(annualAverage(months)).toBe("4.2441");
  });

  it("finds the rate in force on a day without one", () => {
    const fixings = [fixing("2026-10-15", "4.3700"), fixing("2026-10-16", "4.3712")];
    expect(inForce(fixings, "USD", "2026-10-18")?.fixing.date).toBe("2026-10-16");
    expect(inForce(fixings, "USD", "2026-10-14")).toBeUndefined();
    expect(inForce(fixings, "EUR", "2026-10-18")).toBeUndefined();
  });
});

describe("BNR's XML", () => {
  it("reads every fixing as BNR wrote it, multipliers included", () => {
    const doc = ratesIn(
      '<?xml version="1.0"?><DataSet xmlns="http://www.bnr.ro/xsd"><Header><PublishingDate>2021-01-03</PublishingDate></Header><Body>' +
        '<Cube date="2020-01-03"><Rate currency="EUR">4.7789</Rate><Rate currency="HUF" multiplier="100">1.4501</Rate></Cube></Body></DataSet>',
      "test",
    );
    expect(doc).toEqual({ publishedOn: "2021-01-03", fixings: [{ date: "2020-01-03", rates: { EUR: { value: "4.7789", multiplier: 1 }, HUF: { value: "1.4501", multiplier: 100 } } }] });
  });

  it("refuses an HTML page, a foreign document and a rate that is not a decimal", () => {
    expect(() => ratesIn("<!doctype html><html><body>BNR</body></html>", "x")).toThrow();
    expect(() => ratesIn('<?xml version="1.0"?><rates/>', "x")).toThrow();
    expect(() => ratesIn('<DataSet xmlns="http://www.bnr.ro/xsd"><Cube date="2020-01-03"><Rate currency="EUR">4,7789</Rate></Cube></DataSet>', "x")).toThrow();
  });
});

describe("conversion and series", () => {
  it("converts both ways in exact decimals, rounding once", () => {
    const eur = { value: "4.9474", multiplier: 1 };
    expect(formatDecimal(converted(toDecimal("0.10"), eur, "to_ron", 2, "half-up"))).toBe("0.49");
    expect(formatDecimal(converted(toDecimal("0.30"), eur, "to_ron", 4, "half-up"))).toBe("1.4842");
    expect(formatDecimal(converted(toDecimal("100"), { value: "1.2354", multiplier: 100 }, "from_ron", 2, "half-up"))).toBe("8094.54");
    expect(() => converted(toDecimal("1"), { value: "0.0000", multiplier: 1 }, "from_ron", 2, "half-up")).toThrow();
  });

  it("splits a currency's series where its multiplier changed", () => {
    const fixings = [
      { date: "2026-01-06", rates: { HUF: { value: "1.2000", multiplier: 1 }, USD: { value: "4.2000", multiplier: 1 } } },
      { date: "2026-01-05", rates: { HUF: { value: "1.1900", multiplier: 1 } } },
      { date: "2026-01-07", rates: { HUF: { value: "120.0000", multiplier: 100 } } },
    ];
    expect(seriesOf(fixings, ["USD", "HUF", "EUR"])).toEqual([
      { currency: "USD", multiplier: 1, fixings: [{ date: "2026-01-06", rate: "4.2000" }] },
      { currency: "HUF", multiplier: 1, fixings: [{ date: "2026-01-05", rate: "1.1900" }, { date: "2026-01-06", rate: "1.2000" }] },
      { currency: "HUF", multiplier: 100, fixings: [{ date: "2026-01-07", rate: "120.0000" }] },
    ]);
    expect(fixingOn(fixings, "2026-01-06")?.date).toBe("2026-01-06");
    expect(fixingOn(fixings, "2026-01-04")).toBeUndefined();
  });

  it("refuses a window holding more rates than a call answers, before answering any", async () => {
    // Ten currencies every day of 2025, invented: 3,650 rates.
    const fixings = Array.from({ length: 365 }, (_, i) => ({
      date: addDays("2025-01-01", i),
      rates: Object.fromEntries(["AUD", "CAD", "CHF", "CZK", "DKK", "EUR", "GBP", "NOK", "SEK", "USD"].map((c) => [c, { value: "1.0000", multiplier: 1 }])),
    }));
    const deps = { rates: { year: async () => ({ publishedOn: undefined, fixings }), latest: async () => ({ publishedOn: undefined, fixings }) }, now: () => Date.UTC(2026, 0, 10), timeZone: "Europe/Bucharest" };
    await expect(rates(deps, { currencies: undefined, date: undefined, from: "2025-01-01", to: "2025-12-31" })).rejects.toMatchObject({ error: { kind: "input", message: expect.stringContaining("3650 rates") } });
    expect((await rates(deps, { currencies: ["EUR", "USD"], date: undefined, from: "2025-01-01", to: "2025-12-31" })).count).toBe(730);
  });
});
