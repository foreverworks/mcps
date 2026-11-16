import { addDays, formatDecimal, toDecimal } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { rates } from "../src/app/usecases/series.js";
import { converted, perEuro } from "../src/domain/convert.js";
import { countOf, type Fixing, fixingOn, merged, positiveRate, windowOf, withoutTrailingZeros } from "../src/domain/rates.js";
import { ratesIn } from "../src/infra/xml.js";

const fixing = (date: string, rates: Record<string, string>): Fixing => ({ date, rates });

describe("a rate's text", () => {
  it("drops trailing zeros and nothing else", () => {
    for (const [text, expected] of [["365.60", "365.6"], ["1.1000", "1.1"], ["100.00", "100"], ["13111", "13111"], ["100", "100"], ["10.5", "10.5"], ["0.50", "0.5"], ["20163.71", "20163.71"], ["1.0500", "1.05"]] as const)
      expect(withoutTrailingZeros(text)).toBe(expected);
  });

  it("accepts only a positive plain decimal: zero converts nothing and a minus, a comma, an exponent or N/A is no rate", () => {
    expect(positiveRate("1.1052")).toBe("1.1052");
    expect(positiveRate("365.60")).toBe("365.6");
    for (const text of ["0", "0.0000", "-1.1", "1,1", "1e3", "N/A", "", " 1.1", "1.123456789"]) expect(positiveRate(text)).toBeUndefined();
  });
});

describe("the ECB's XML", () => {
  const head = '<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject><gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender><Cube>';
  const foot = "</Cube></gesmes:Envelope>";

  it("reads the history's style, newest first, into fixings oldest first", () => {
    const doc = ratesIn(`${head}<Cube time="2026-11-13"><Cube currency="USD" rate="1.1052"/><Cube currency="HUF" rate="365.6"/></Cube><Cube time="2026-11-12"><Cube currency="USD" rate="1.1081"/></Cube>${foot}`, "test");
    expect(doc.fixings).toEqual([fixing("2026-11-12", { USD: "1.1081" }), fixing("2026-11-13", { USD: "1.1052", HUF: "365.6" })]);
  });

  it("reads the daily file's style too: indented, single quotes, a trailing zero", () => {
    const daily = `<?xml version="1.0" encoding="UTF-8"?>\n<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns='http://www.ecb.int/vocabulary/2002-08-01/eurofxref'>\n\t<Cube>\n\t\t<Cube time='2026-11-13'>\n\t\t\t<Cube currency='HUF' rate='365.60'/>\n\t\t</Cube>\n\t</Cube>\n</gesmes:Envelope>`;
    expect(ratesIn(daily, "test").fixings).toEqual([fixing("2026-11-13", { HUF: "365.6" })]);
  });

  it("refuses an HTML page, a foreign document, and a fixing it cannot read, as drift", () => {
    const refusals: [string, string][] = [
      ["<!doctype html><html><body>blocked</body></html>", "HTML page"],
      ['<?xml version="1.0"?><rates/>', "not its rates XML"],
      [`${head}<Cube time="2026-13-45"><Cube currency="USD" rate="1.1"/></Cube>${foot}`, "dated"],
      [`${head}<Cube time="2026-11-13"><Cube currency="USD" rate="1,1052"/></Cube>${foot}`, '"1,1052"'],
      [`${head}<Cube time="2026-11-13"><Cube currency="USD" rate="0"/></Cube>${foot}`, "USD on 2026-11-13"],
      [`${head}<Cube time="2026-11-13"></Cube>${foot}`, "no rates"],
      [`${head}${foot}`, "no fixings"],
    ];
    for (const [text, message] of refusals) expect(() => ratesIn(text, "x"), message).toThrow(expect.objectContaining({ error: expect.objectContaining({ kind: "drift", message: expect.stringContaining(message) }) }));
  });
});

describe("fixings", () => {
  const list = [fixing("2026-11-09", { USD: "1.1193", BGN: "1.9558" }), fixing("2026-11-12", { USD: "1.1081" }), fixing("2026-11-13", { USD: "1.1052" })];

  it("finds the fixing in force on a day: the last on or before it, none before the first", () => {
    expect(fixingOn(list, "2026-11-13")?.date).toBe("2026-11-13");
    expect(fixingOn(list, "2026-11-14")?.date).toBe("2026-11-13");
    expect(fixingOn(list, "2026-11-10")?.date).toBe("2026-11-09");
    expect(fixingOn(list, "2026-11-08")).toBeUndefined();
  });

  it("merges lists by date, the later list winning, oldest first", () => {
    const stale = [fixing("2026-11-12", { USD: "9.9999" }), fixing("2026-11-09", { USD: "1.1193" })];
    const out = merged(stale, [fixing("2026-11-12", { USD: "1.1081" }), fixing("2026-11-13", { USD: "1.1052" })]);
    expect(out).toEqual([fixing("2026-11-09", { USD: "1.1193" }), fixing("2026-11-12", { USD: "1.1081" }), fixing("2026-11-13", { USD: "1.1052" })]);
  });

  it("cuts a window to the currencies asked, drops a fixing left with none, and counts what is left", () => {
    expect(windowOf(list, "2026-11-09", "2026-11-12", ["BGN"])).toEqual([fixing("2026-11-09", { BGN: "1.9558" })]);
    expect(windowOf(list, "2026-11-10", "2026-11-13", undefined)).toEqual([list[1], list[2]]);
    expect(countOf(windowOf(list, "2026-11-01", "2026-11-30", undefined))).toBe(4);
    expect(windowOf(list, "2026-11-14", "2026-11-15", undefined)).toEqual([]);
  });
});

describe("conversion", () => {
  const usd = perEuro("USD", "1.1052");
  const gbp = perEuro("GBP", "0.83559");
  const eur = perEuro("EUR", undefined);

  it("is one formula for the euro, a currency and a cross rate, rounded once", () => {
    expect(formatDecimal(converted(toDecimal("100"), eur, usd, 2, "half-up"))).toBe("110.52");
    expect(formatDecimal(converted(toDecimal("100"), usd, eur, 2, "half-up"))).toBe("90.48");
    expect(formatDecimal(converted(toDecimal("100"), gbp, usd, 2, "half-up"))).toBe("132.27");
    // Through the euro in two rounded steps this is 132.26; exact, it is 132.2658..., so 132.27.
    expect(formatDecimal(converted(toDecimal("100"), gbp, usd, 4, "half-up"))).toBe("132.2658");
    expect(formatDecimal(converted(toDecimal("0.10"), eur, usd, 2, "half-up"))).toBe("0.11");
  });

  it("converts nothing at a rate that is not positive, and needs a rate for a currency that is not the euro", () => {
    expect(() => perEuro("USD", "0")).toThrow();
    expect(() => perEuro("USD", undefined)).toThrow();
  });
});

describe("a window's size", () => {
  it("is refused before any rate is answered when it holds more than a call carries", async () => {
    // Ten currencies every day of 2025, invented: 3,650 rates.
    const currencies = ["AUD", "CAD", "CHF", "CZK", "DKK", "GBP", "NOK", "SEK", "USD", "JPY"];
    const fixings = Array.from({ length: 365 }, (_, i) => fixing(addDays("2025-01-01", i), Object.fromEntries(currencies.map((c) => [c, "1.0001"]))));
    const [first, ...rest] = fixings;
    if (first === undefined) throw new Error("no fixings");
    const doc = { fixings: [first, ...rest] as [Fixing, ...Fixing[]] };
    const deps = { rates: { latest: async () => doc, recent: async () => doc, history: async () => doc }, now: () => Date.UTC(2026, 0, 10), timeZone: "Europe/Berlin" };
    await expect(rates(deps, { currencies: undefined, date: undefined, from: "2025-01-01", to: "2025-12-31" })).rejects.toMatchObject({ error: { kind: "input", message: expect.stringContaining("3650 rates") } });
    expect((await rates(deps, { currencies: ["USD", "JPY"], date: undefined, from: "2025-01-01", to: "2025-12-31" })).count).toBe(730);
  });
});
