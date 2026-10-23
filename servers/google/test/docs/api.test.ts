/**
 * Docs' full API: the structural read, text found as ranges, and a batch of
 * any requests, run against the simulator (test/docs/simulator.ts) so the
 * ranges find_in_document gives are proven to be the ones a batch can use.
 */
import { describe, expect, it } from "vitest";

import type { Deps, GetOptions, WriteControl } from "../../src/docs/app/ports.js";
import { batchUpdateDocument } from "../../src/docs/app/usecases/batch.js";
import { findInDocument, getDocument } from "../../src/docs/app/usecases/structure.js";
import { indexPaths, pinFor } from "../../src/docs/domain/batch.js";
import { apiError, asAppError, fail, STALE_REVISION } from "../../src/docs/domain/errors.js";
import { patternMatcher } from "../../src/docs/app/patterns.js";
import { readDocument } from "../../src/docs/app/usecases/read.js";
import { appendToDocument } from "../../src/docs/app/usecases/write.js";
import { findText, literalMatcher } from "../../src/docs/domain/find.js";
import { inTab, tabDocument } from "../../src/docs/domain/tabs.js";
import type { RawDocument } from "../../src/docs/domain/schema.js";
import { OBJECT_MARK, outlineOf, pickTab, tabsOf } from "../../src/docs/domain/structure.js";
import type { Deps as DriveDeps } from "../../src/drive/app/ports.js";
import { makeSimulator } from "./simulator.js";

const failureOf = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return asAppError(e);
  }
  throw new Error("expected a failure");
};

const simulated = () => {
  const sim = makeSimulator([{ text: "Plan", named: "HEADING_1" }, { text: "Ship the old build, then the old docs." }, { text: "Risks", named: "HEADING_2" }, { text: "none" }]);
  let revision = 1;
  const gets: (GetOptions | undefined)[] = [];
  const pins: WriteControl[] = [];
  const deps: Deps = {
    account: "work",
    docs: {
      get: async (_, options) => {
        gets.push(options);
        return { ...(sim.document() as RawDocument), revisionId: `r${revision}` };
      },
      batchUpdate: async () => fail(apiError(500, "not used here")),
      apply: async (_, requests, pin) => {
        pins.push(pin);
        if (pin.requiredRevisionId && pin.requiredRevisionId !== `r${revision}`) {
          return fail(
            apiError(400, "Google Docs rejected POST https://docs.googleapis.com/v1/documents/doc1:batchUpdate", {
              body: { error: { code: 400, message: "The required revision ID 'r0' does not match the latest revision.", status: "INVALID_ARGUMENT" } },
            }),
          );
        }
        sim.applyAll(requests);
        revision += 1;
        return { documentId: "doc1", replies: requests.map(() => ({})), writeControl: { requiredRevisionId: `r${revision}` } };
      },
    },
    drive: {} as DriveDeps,
  };
  return { deps, sim, gets, pins };
};

/** A document with tabs, an image, a footnote, a table and a header, as Docs returns it with includeTabsContent. */
const TABBED: RawDocument = {
  documentId: "d2",
  title: "Tabbed",
  revisionId: "rv9",
  tabs: [
    {
      tabProperties: { tabId: "t.0", title: "Main", index: 0 },
      documentTab: {
        body: {
          content: [
            { endIndex: 1, sectionBreak: { sectionStyle: { columnSeparatorStyle: "NONE", sectionType: "CONTINUOUS" } } },
            {
              startIndex: 1,
              endIndex: 12,
              paragraph: {
                paragraphStyle: { namedStyleType: "NORMAL_TEXT", direction: "LEFT_TO_RIGHT", alignment: "CENTER" },
                elements: [
                  { startIndex: 1, endIndex: 4, textRun: { content: "See", textStyle: {} } },
                  { startIndex: 4, endIndex: 5, inlineObjectElement: { inlineObjectId: "kix.img1", textStyle: {} } },
                  { startIndex: 5, endIndex: 9, textRun: { content: " now", textStyle: { bold: true, foregroundColor: { color: { rgbColor: { red: 1 } } } } } },
                  { startIndex: 9, endIndex: 10, footnoteReference: { footnoteId: "kix.fn1", footnoteNumber: "1" } },
                  { startIndex: 10, endIndex: 12, textRun: { content: "!\n", textStyle: {} } },
                ],
              },
            },
            {
              startIndex: 12,
              endIndex: 26,
              table: {
                rows: 1,
                columns: 2,
                tableRows: [
                  {
                    startIndex: 13,
                    endIndex: 25,
                    tableRowStyle: { minRowHeight: { unit: "PT" } },
                    tableCells: [
                      {
                        startIndex: 14,
                        endIndex: 19,
                        tableCellStyle: { rowSpan: 1, columnSpan: 1, paddingLeft: { magnitude: 5, unit: "PT" } },
                        content: [{ startIndex: 15, endIndex: 19, paragraph: { elements: [{ startIndex: 15, endIndex: 19, textRun: { content: "now\n" } }] } }],
                      },
                      {
                        startIndex: 19,
                        endIndex: 25,
                        tableCellStyle: { rowSpan: 1, columnSpan: 1, paddingLeft: { magnitude: 5, unit: "PT" }, backgroundColor: { color: { rgbColor: { green: 1 } } } },
                        content: [{ startIndex: 20, endIndex: 25, paragraph: { elements: [{ startIndex: 20, endIndex: 25, textRun: { content: "Now!\n" } }] } }],
                      },
                    ],
                  },
                ],
              },
            },
            { startIndex: 26, endIndex: 27, paragraph: { elements: [{ startIndex: 26, endIndex: 27, textRun: { content: "\n" } }], paragraphStyle: { namedStyleType: "NORMAL_TEXT" } } },
          ],
        },
        headers: { "kix.h1": { headerId: "kix.h1", content: [{ startIndex: 0, endIndex: 9, paragraph: { elements: [{ startIndex: 0, endIndex: 9, textRun: { content: "Know now\n" } }] } }] } },
        footnotes: { "kix.fn1": { footnoteId: "kix.fn1", content: [] } },
        inlineObjects: { "kix.img1": { objectId: "kix.img1", inlineObjectProperties: { embeddedObject: { size: { width: { magnitude: 120, unit: "PT" }, height: { magnitude: 80, unit: "PT" } } } } } },
        namedRanges: { total: { name: "total", namedRanges: [{ namedRangeId: "kix.nr1", name: "total", ranges: [{ startIndex: 5, endIndex: 9 }] }] } },
      },
      childTabs: [{ tabProperties: { tabId: "t.child", title: "Notes", index: 0, parentTabId: "t.0", nestingLevel: 1 }, documentTab: { body: { content: [] } } }],
    },
  ],
};

describe("the outline", () => {
  it("lists every tab depth first and picks one by id or unique title", () => {
    const tabs = tabsOf(TABBED);
    expect(tabs.map((t) => t.row)).toEqual([
      { tabId: "t.0", title: "Main", index: 0, level: 0 },
      { tabId: "t.child", title: "Notes", index: 0, level: 1, parentTabId: "t.0" },
    ]);
    expect(pickTab(tabs, "notes").row.tabId).toBe("t.child");
    expect(pickTab(tabs, "").row.tabId).toBe("t.0");
  });

  it("keeps index arithmetic exact: one mark per non-text index, styled runs and objects with their own positions", () => {
    const out = outlineOf(pickTab(tabsOf(TABBED), "t.0").content, { parts: ["body"], maxChars: 100_000 });
    const [section, paragraph, table] = out.body as Record<string, any>[];
    expect(section).toEqual({ type: "sectionBreak", range: [0, 1], sectionStyle: { columnSeparatorStyle: "NONE", sectionType: "CONTINUOUS" } });
    expect(paragraph).toMatchObject({
      type: "paragraph",
      range: [1, 12],
      text: `See${OBJECT_MARK} now${OBJECT_MARK}!`,
      paragraphStyle: { alignment: "CENTER" },
      runs: [{ range: [5, 9], text: " now", style: { bold: true, foregroundColor: "#ff0000" } }],
      objects: [
        { at: 4, type: "inlineObject", objectId: "kix.img1" },
        { at: 9, type: "footnoteReference", footnoteId: "kix.fn1", number: "1" },
      ],
    });
    // offset k of text is index range[0] + k; the newline is range[1] - 1
    expect(paragraph?.text.indexOf("!") + 1).toBe(10);
    expect(table).toMatchObject({ type: "table", range: [12, 26], rows: 1, columns: 2, cellStyle: { paddingLeft: "5pt" }, rowStyle: { minRowHeight: "0pt" } });
    expect(table?.cells[0].cells[0]).toEqual({ range: [14, 19], content: [{ type: "paragraph", range: [15, 19], text: "now" }] });
    expect(table?.cells[0].cells[1]).toMatchObject({ range: [19, 25], style: { paddingLeft: "5pt", backgroundColor: "#00ff00" } });
    expect(out.notShown).toEqual({ headers: ["kix.h1"], footnotes: 1, namedRanges: ["total"], inlineObjects: 1 });
  });

  it("adds the parts asked for and cuts a long body at an element, saying where to go on", () => {
    const tab = pickTab(tabsOf(TABBED), "t.0").content;
    const parts = outlineOf(tab, { parts: ["headers", "named_ranges", "objects"], maxChars: 100_000 });
    expect(parts.body).toBeUndefined();
    expect(parts.headers).toEqual({ "kix.h1": [{ type: "paragraph", range: [0, 9], text: "Know now" }] });
    expect(parts.namedRanges).toEqual({ total: [{ namedRangeId: "kix.nr1", ranges: [{ range: [5, 9] }] }] });
    expect(parts.inlineObjects).toEqual({ "kix.img1": { size: { width: "120pt", height: "80pt" } } });
    const cut = outlineOf(tab, { parts: ["body"], maxChars: 150 });
    expect(cut).toMatchObject({ truncated: true, nextIndex: 1 });
    expect(outlineOf(tab, { parts: ["body"], maxChars: 100_000, startIndex: 12 }).body).toHaveLength(2);
  });
});

describe("find", () => {
  it("finds literal text in body, table cells and headers, by case and whole word, as ranges", () => {
    const tab = pickTab(tabsOf(TABBED), "t.0").content;
    const all = findText(tab, literalMatcher("now", { matchCase: false, wholeWord: false }), { segments: "all", limit: 50 });
    expect(all.matches.map((m) => [m.range, m.segmentId ?? "body", m.paragraph.inTable ?? false])).toEqual([
      [[6, 9], "body", false],
      [[15, 18], "body", true],
      [[20, 23], "body", true],
      [[1, 4], "kix.h1", false],
      [[5, 8], "kix.h1", false],
    ]);
    expect(findText(tab, literalMatcher("Now", { matchCase: true, wholeWord: false }), { segments: "body", limit: 50 }).matches.map((m) => m.range)).toEqual([[20, 23]]);
    expect(findText(tab, literalMatcher("now", { matchCase: false, wholeWord: true }), { segments: "all", limit: 50 }).total).toBe(4);
    expect(findText(tab, literalMatcher("now", { matchCase: false, wholeWord: false }), { segments: "all", limit: 2 })).toMatchObject({ total: 5, matches: [{}, {}] });
  });

  it("keeps indices right past a character whose lower case is longer", () => {
    const doc: RawDocument = {
      body: { content: [{ startIndex: 1, endIndex: 9, paragraph: { elements: [{ startIndex: 1, endIndex: 9, textRun: { content: "İstanbu\n" } }] } }] },
    };
    expect(findText(tabsOf(doc)[0]!.content, literalMatcher("STAN", { matchCase: false, wholeWord: false }), { segments: "body", limit: 5 }).matches[0]?.range).toEqual([2, 6]);
  });
});

describe("the pin", () => {
  it("requires a revision for any request that names an index, and accepts one either way", async () => {
    const insert = [{ insertText: { location: { index: 3 }, text: "x" } }];
    expect(indexPaths([{ updateTableCellStyle: { tableRange: { tableCellLocation: { tableStartLocation: { index: 12 } } } } }])).toEqual([
      "requests[0].updateTableCellStyle.tableRange.tableCellLocation.tableStartLocation.index",
    ]);
    expect(await failureOf(() => pinFor(insert, "", ""))).toMatchObject({ kind: "input", message: expect.stringContaining("requests[0].insertText.location.index") });
    expect(await failureOf(() => pinFor(insert, "r1", "r1"))).toMatchObject({ kind: "input" });
    expect(pinFor(insert, "r1", "")).toEqual({ requiredRevisionId: "r1" });
    expect(pinFor(insert, "", "r1")).toEqual({ targetRevisionId: "r1" });
    expect(pinFor([{ replaceAllText: { containsText: { text: "a" }, replaceText: "b" } }], "", "")).toEqual({});
    expect(pinFor([{ insertText: { endOfSegmentLocation: {}, text: "x" } }], "", "")).toEqual({});
  });
});

describe("the use cases over the simulator", () => {
  it("reads the outline with every tab's content, and a raw read narrowed by fields", async () => {
    const { deps, gets } = simulated();
    const read = await getDocument(deps, { documentId: "doc1", tab: "", parts: ["body"], suggestions: "", format: "outline", fields: "", maxChars: 60_000 });
    expect(read).toMatchObject({ revisionId: "r1", tabs: [{ tabId: "" }], body: [{ type: "sectionBreak" }, { style: "HEADING_1", text: "Plan" }, {}, {}, {}] });
    await getDocument(deps, { documentId: "doc1", tab: "", parts: ["body"], suggestions: "SUGGESTIONS_INLINE", format: "raw", fields: "body", maxChars: 60_000 });
    expect(gets).toEqual([{ tabs: true }, { tabs: true, suggestions: "SUGGESTIONS_INLINE", fields: "body" }]);
    expect(await failureOf(getDocument(deps, { documentId: "doc1", tab: "", parts: ["body"], suggestions: "", format: "raw", fields: "", maxChars: 100 }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("narrow it with fields"),
    });
  });

  it("styles what find_in_document found, back to front, pinned to the revision it read", async () => {
    const { deps, sim, pins } = simulated();
    const found = await findInDocument(deps, { documentId: "doc1", text: "old", tab: "", matchCase: false, wholeWord: true, regex: false, segments: "all", limit: 10 });
    expect(found.total).toBe(2);
    const requests = found.matches
      .slice()
      .reverse()
      .flatMap((m) => [
        { deleteContentRange: { range: { startIndex: m.range[0], endIndex: m.range[1] } } },
        { insertText: { location: { index: m.range[0] }, text: "new" } },
        { updateTextStyle: { range: { startIndex: m.range[0], endIndex: m.range[0] + 3 }, textStyle: { bold: true }, fields: "bold" } },
      ]);
    const done = await batchUpdateDocument(deps, { documentId: "doc1", requests, expectedRevision: found.revisionId ?? "", targetRevision: "", images: {} });
    expect(done).toMatchObject({ revisionId: "r2", applied: 6, replies: [] });
    expect(pins).toEqual([{ requiredRevisionId: "r1" }]);
    expect(sim.text()).toContain("Ship the new build, then the new docs.");
    const after = await getDocument(deps, { documentId: "doc1", tab: "", parts: ["body"], suggestions: "", format: "outline", fields: "", maxChars: 60_000 });
    const runs = (after as unknown as { body: Record<string, any>[] }).body[2]?.runs;
    expect(runs.map((r: { text: string; style: unknown }) => [r.text, r.style])).toEqual([
      ["new", { bold: true }],
      ["new", { bold: true }],
    ]);
  });

  it("calls a moved-on revision stale, and sends nothing for a request the schema refuses", async () => {
    const { deps, pins } = simulated();
    const stale = await failureOf(
      batchUpdateDocument(deps, { documentId: "doc1", requests: [{ insertText: { location: { index: 1 }, text: "x" } }], expectedRevision: "r0", targetRevision: "", images: {} }),
    );
    expect(stale).toMatchObject({ kind: "api", reason: STALE_REVISION, message: "The required revision ID 'r0' does not match the latest revision." });
    const wrong = await failureOf(batchUpdateDocument(deps, { documentId: "doc1", requests: [{ insertText: { location: { index: 1 }, txt: "x" } }], expectedRevision: "r1", targetRevision: "", images: {} }));
    expect(wrong).toMatchObject({ kind: "input", message: expect.stringContaining('did you mean text?') });
    expect(pins).toHaveLength(1);
  });
});

describe("patterns", () => {
  const tab = () => pickTab(tabsOf(TABBED), "t.0").content;

  it("finds a regular expression's matches as ranges, by case or not", () => {
    const found = findText(tab(), patternMatcher("[Nn]ow!?", true), { segments: "body", limit: 50 });
    expect(found.matches.map((m) => [m.range, m.text])).toEqual([
      [[6, 9], "now"],
      [[15, 18], "now"],
      [[20, 24], "Now!"],
    ]);
    expect(findText(tab(), patternMatcher("^k", false), { segments: "all", limit: 50 }).matches.map((m) => m.segmentId)).toEqual(["kix.h1"]);
  });

  it("stops a pattern that backtracks without stalling the process, and refuses one that does not parse", async () => {
    const long: RawDocument = {
      body: { content: [{ startIndex: 1, endIndex: 43, paragraph: { elements: [{ startIndex: 1, endIndex: 43, textRun: { content: `${"a".repeat(40)}!\n` } }] } }] },
    };
    const started = Date.now();
    expect(await failureOf(() => findText(tabsOf(long)[0]!.content, patternMatcher("(a+)+$", true), { segments: "body", limit: 5 }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("was stopped"),
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await failureOf(() => findText(tab(), patternMatcher("(", true), { segments: "body", limit: 5 }))).toMatchObject({ message: expect.stringContaining("not a regular expression") });
  });
});

describe("the markdown tools on another tab", () => {
  const twoTabs: RawDocument = {
    documentId: "d3",
    title: "Two",
    revisionId: "rv1",
    tabs: [
      { tabProperties: { tabId: "t.0", title: "Main" }, documentTab: { body: { content: [{ endIndex: 1, sectionBreak: {} }, { startIndex: 1, endIndex: 6, paragraph: { elements: [{ startIndex: 1, endIndex: 6, textRun: { content: "main\n" } }] } }] } } },
      {
        tabProperties: { tabId: "t.n", title: "Notes" },
        documentTab: {
          body: {
            content: [
              { endIndex: 1, sectionBreak: {} },
              { startIndex: 1, endIndex: 7, paragraph: { elements: [{ startIndex: 1, endIndex: 7, textRun: { content: "Notes\n" } }], paragraphStyle: { namedStyleType: "HEADING_1", headingId: "h.n" } } },
              { startIndex: 7, endIndex: 8, paragraph: { elements: [{ startIndex: 7, endIndex: 8, textRun: { content: "\n" } }] } },
            ],
          },
        },
      },
    ],
  };

  it("reads a tab as its own document and puts its id on every location and range", () => {
    expect(tabDocument(twoTabs, "notes")).toMatchObject({ tabId: "t.n", document: { documentId: "d3", revisionId: "rv1", body: { content: [{}, {}, {}] } } });
    expect(
      inTab(
        [
          { insertText: { location: { index: 3 }, text: "x" } },
          { updateTextStyle: { range: { startIndex: 1, endIndex: 2 }, textStyle: { bold: true }, fields: "bold" } },
          { insertTable: { rows: 1, columns: 1, location: { index: 5 } } },
        ],
        "t.n",
      ),
    ).toEqual([
      { insertText: { location: { index: 3, tabId: "t.n" }, text: "x" } },
      { updateTextStyle: { range: { startIndex: 1, endIndex: 2, tabId: "t.n" }, textStyle: { bold: true }, fields: "bold" } },
      { insertTable: { rows: 1, columns: 1, location: { index: 5, tabId: "t.n" } } },
    ]);
  });

  it("read_document and append_to_document address the tab named", async () => {
    const sent: unknown[] = [];
    const gets: unknown[] = [];
    const deps = {
      account: "work",
      docs: {
        get: async (_: string, options?: unknown) => (gets.push(options), twoTabs),
        batchUpdate: async (_: string, requests: unknown[]) => (sent.push(...requests), "rv2"),
        apply: async () => ({}),
      },
      drive: {} as DriveDeps,
    } as unknown as Deps;
    const read = await readDocument(deps, { documentId: "d3", section: "", maxChars: 10_000, tab: "Notes" });
    expect(read).toMatchObject({ tabId: "t.n", markdown: expect.stringContaining("# Notes") });
    const appended = await appendToDocument(deps, { documentId: "d3", markdown: "added", expectedRevision: "rv1", tab: "t.n" });
    expect(appended).toMatchObject({ tabId: "t.n", revisionId: "rv2" });
    expect(gets).toEqual([{ tabs: true }, { tabs: true }]);
    expect(JSON.stringify(sent)).toContain('"tabId":"t.n"');
    expect(JSON.stringify(sent)).not.toMatch(/"location":\{"index":\d+\}/);
  });
});
