import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { asAppError } from "../src/domain/errors.js";
import { onlyInCancelled } from "../src/infra/uspto/mapping.js";
import { searchBody } from "../src/infra/uspto/query.js";
import { usptoAnswer, usptoDetail } from "./fixtures.js";
import { noSleep, stubFetch, type Answer } from "./stubFetch.js";

const usOnly = (answer: (n: number) => Answer) => {
  const stub = stubFetch((_, n) => answer(n));
  const deps = buildDeps({ TRADEMARKS_SOURCES: "uspto" }, { fetch: stub.fetch, sleep: noSleep, random: () => 0 });
  const us = deps.registers.find((r) => r.office === "US");
  if (us === undefined) throw new Error("no US register");
  return { us, asked: stub.asked };
};

const failureOf = async (p: Promise<unknown>) => asAppError(await p.then(() => undefined, (e: unknown) => e));

describe("the USPTO query", () => {
  it("asks exact and word as a phrase only, classes as USPTO writes them, live through its flag", () => {
    const body = searchBody({ name: "Turnip", classes: [9, 35, 42], match: "exact", status: "live" });
    const clauses = JSON.stringify(body.query.bool.should);
    expect(clauses).toContain('"match_phrase":{"WM"');
    expect(clauses).toContain('"term":{"WM":{"value":"turnip"');
    expect(clauses).not.toContain("WMP5");
    expect(clauses).not.toContain("fuzziness");
    expect(body.query.bool).toMatchObject({ minimum_should_match: 1, filter: [{ terms: { IC: ["009", "035", "042"] } }, { term: { LD: "true" } }] });
    expect(body.size).toBe(100);
  });

  it("filters goods as the search page does, a phrase on GS, and asks for their text back", () => {
    const body = searchBody({ name: "Turnip", classes: [42], match: "word", status: "live", goods: "computer software" });
    expect(body.query.bool.filter).toEqual([{ terms: { IC: ["042"] } }, { match_phrase: { GS: { query: "computer software" } } }, { term: { LD: "true" } }]);
    expect(body._source).toContain("goodsAndServices");
    expect(searchBody({ name: "Turnip", classes: [], match: "word", status: "live" })._source).not.toContain("goodsAndServices");
  });

  it("drops a mark only when the goods words appear in classes it has cancelled and nowhere else", () => {
    const entries = ["IC 009: Downloadable computer software for invoicing.", "(CANCELLED) IC 042: [ Software as a service for scheduling ]."];
    expect(onlyInCancelled(entries, "Computer-Software")).toBe(false);
    expect(onlyInCancelled(entries, "software as a service")).toBe(true);
    // USPTO's analyser may match a plural or a stem these words never spell: such a mark stays.
    expect(onlyInCancelled(entries, "computer programs")).toBe(false);
    expect(onlyInCancelled(undefined, "software")).toBe(false);
  });

  it("adds prefix, sound-alike and edit distance for similar, and no class or status filter when none is asked", () => {
    const body = searchBody({ name: "Blue Night", classes: [], match: "similar", status: "all" });
    const clauses = JSON.stringify(body.query.bool.should);
    expect(clauses).toContain("WMP5");
    expect(clauses).toContain('"fuzziness":"AUTO"');
    expect(clauses).toContain("match_phrase_prefix");
    // Two words are no single token: no term on WM.
    expect(clauses).not.toContain('"term"');
    expect(body.query.bool).not.toHaveProperty("filter");
  });
});

describe("the USPTO register", () => {
  it("posts to the backend with an honest user agent and maps what comes back", async () => {
    const { us, asked } = usOnly(() => ({ json: usptoAnswer() }));
    const page = await us.search({ name: "Turnip", classes: [9, 35, 42], match: "similar", status: "live" });
    expect(asked[0]).toMatchObject({ url: "https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch", method: "POST" });
    expect(asked[0]?.headers["user-agent"]).toMatch(/^mcps-trademarks\//);
    expect(page.found).toBe(42);
    const [registered, pending, renewed, dead, , translated, design] = page.marks;
    expect(registered).toEqual({
      office: "US",
      id: "90000001",
      mark: "TURNIP",
      status: "registered",
      statusText: "REGISTERED",
      owners: ["EXAMPLE SOFTWARE, INC. (CORPORATION; OREGON, USA)"],
      classes: [42],
      kind: "word",
      filed: "2021-03-15",
      registered: "2022-09-06",
      registrationNumber: "7000001",
      link: "https://tsdr.uspto.gov/#caseNumber=90000001&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch",
    });
    expect(pending).toMatchObject({ status: "pending", statusText: "NON-FINAL ACTION - MAILED", classes: [9, 35, 42] });
    expect(pending).not.toHaveProperty("registered");
    // A cancelled class is no longer covered; a dead registration keeps the classes it had.
    expect(renewed?.classes).toEqual([7, 20]);
    expect(dead).toMatchObject({ status: "dead", classes: [16, 35, 42] });
    expect(translated?.translation).toContain('"turnip"');
    expect(design).toMatchObject({ mark: null, kind: "figurative" });
  });

  it("reads one mark's goods and services, cancelled classes marked and long text cut", async () => {
    const { us, asked } = usOnly(() => ({ json: usptoAnswer([{ id: "90000001", score: 1, source: usptoDetail }], 1) }));
    const detail = await us.get("90000001");
    expect(JSON.parse(asked[0]?.body ?? "{}")).toMatchObject({ query: { term: { id: "90000001" } }, size: 1 });
    expect(detail.goodsAndServices).toHaveLength(2);
    expect(detail.goodsAndServices[0]?.class).toBe(42);
    expect(detail.goodsAndServices[0]?.terms.length).toBe(603);
    expect(detail.goodsAndServices[1]).toEqual({ class: 35, cancelled: true, terms: "[ Business consultancy ]." });
  });

  it("refuses a number that is not a serial without asking, and says not found when there is none", async () => {
    const { us, asked } = usOnly(() => ({ json: usptoAnswer([], 0) }));
    expect(await failureOf(us.get("3000003"))).toMatchObject({ kind: "input" });
    expect(asked).toHaveLength(0);
    expect(await failureOf(us.get("99999999"))).toMatchObject({ kind: "not_found" });
  });

  it("reports a refusal as such, with what it probably means, and a page it does not know as drift", async () => {
    const refused = usOnly(() => ({ status: 403, text: "<html>Request blocked</html>" }));
    const error = await failureOf(refused.us.search({ name: "Turnip", classes: [], match: "exact", status: "live" }));
    expect(error).toMatchObject({ kind: "api", source: "uspto-tmsearch", status: 403 });
    expect(error?.message).toContain("browser challenge");

    const changed = usOnly(() => ({ json: { results: [] } }));
    expect(await failureOf(changed.us.search({ name: "Turnip", classes: [], match: "exact", status: "live" }))).toMatchObject({ kind: "drift", source: "uspto-tmsearch" });

    const ownQuery = usOnly(() => ({ status: 400, json: { error: "parsing_exception" } }));
    expect(await failureOf(ownQuery.us.search({ name: "Turnip", classes: [], match: "exact", status: "live" }))).toMatchObject({ kind: "drift" });
  });

  it("leaves out a mark whose goods match only in a cancelled class", async () => {
    const goods = (id: string, entries: string[]) => ({ id, score: 1, source: { id, wordmark: "TURNIP", alive: true, internationalClass: ["IC 009"], goodsAndServices: entries } });
    const { us } = usOnly(() => ({
      json: usptoAnswer([goods("90000010", ["IC 009: Computer software."]), goods("90000011", ["IC 009: Bags.", "(CANCELLED) IC 042: [ Computer software design ]."])], 2),
    }));
    const page = await us.search({ name: "Turnip", classes: [], match: "word", status: "live", goods: "computer software" });
    expect(page.marks.map((m) => m.id)).toEqual(["90000010"]);
    expect(page.found).toBe(2);
  });

  it("retries a 5xx and gets there", async () => {
    const { us, asked } = usOnly((n) => (n === 0 ? { status: 503, text: "busy" } : { json: usptoAnswer([], 0) }));
    await expect(us.search({ name: "Turnip", classes: [], match: "exact", status: "live" })).resolves.toEqual({ found: 0, marks: [] });
    expect(asked).toHaveLength(2);
  });
});
