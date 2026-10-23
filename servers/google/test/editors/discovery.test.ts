/**
 * The Discovery layer the three batch tools share: requests checked against
 * the APIs' own vendored schemas, the reference a model reads, and the replies
 * reduced to what carries an id or a count. Pure: no network, no grant.
 */
import { describe, expect, it } from "vitest";

import { DOCS_API } from "../../src/docs/domain/api.js";
import { checked, repliesOf } from "../../src/editors/domain/batch.js";
import { compact } from "../../src/editors/domain/compact.js";
import { checkRequests, reference, requestKinds, suggestion } from "../../src/editors/domain/discovery.js";
import { asAppError } from "../../src/editors/domain/errors.js";
import { SHEETS_API } from "../../src/sheets/domain/api.js";
import { SLIDES_API } from "../../src/slides/domain/api.js";

const failureOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return asAppError(e);
  }
  throw new Error("expected a failure");
};

describe("the vendored schemas", () => {
  it("hold every request kind each API documents", () => {
    expect(Object.keys(requestKinds(DOCS_API))).toEqual(expect.arrayContaining(["insertText", "updateTextStyle", "insertTable", "createHeader", "addDocumentTab", "replaceAllText"]));
    expect(Object.keys(requestKinds(SHEETS_API))).toEqual(expect.arrayContaining(["repeatCell", "addConditionalFormatRule", "setDataValidation", "addChart", "sortRange", "addSheet"]));
    expect(Object.keys(requestKinds(SLIDES_API))).toEqual(expect.arrayContaining(["createSlide", "createShape", "createImage", "insertText", "updatePageElementTransform"]));
    expect(Object.keys(requestKinds(SHEETS_API)).length).toBeGreaterThan(60);
  });
});

describe("checkRequests", () => {
  it("accepts well-formed requests of every shape: nested types, arrays, enums, maps", () => {
    expect(
      checkRequests(DOCS_API, [
        { insertText: { location: { index: 1 }, text: "Hello\n" } },
        { updateTextStyle: { range: { startIndex: 1, endIndex: 6 }, textStyle: { bold: true, fontSize: { magnitude: 14, unit: "PT" } }, fields: "bold,fontSize" } },
        { updateParagraphStyle: { range: { startIndex: 1, endIndex: 6 }, paragraphStyle: { namedStyleType: "HEADING_1", alignment: "CENTER" }, fields: "namedStyleType,alignment" } },
        { replaceAllText: { containsText: { text: "{{x}}", matchCase: true }, replaceText: "y" } },
      ]),
    ).toEqual([]);
    expect(
      checkRequests(SHEETS_API, [
        {
          addConditionalFormatRule: {
            index: 0,
            rule: {
              ranges: [{ sheetId: 0, startRowIndex: 1 }],
              booleanRule: { condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "10" }] }, format: { backgroundColor: { red: 1 } } },
            },
          },
        },
      ]),
    ).toEqual([]);
  });

  it("names a misspelt kind or field with the nearest right name", () => {
    expect(checkRequests(DOCS_API, [{ insertTxt: { text: "x" } }])).toEqual([expect.stringMatching(/^requests\[0\]\.insertTxt: not a docs request kind; did you mean insertText\?/)]);
    expect(checkRequests(DOCS_API, [{ insertText: { locaton: { index: 1 }, text: "x" } }])).toEqual([
      expect.stringMatching(/requests\[0\]\.insertText\.locaton: InsertTextRequest has no field "locaton"; did you mean location\?/),
    ]);
  });

  it("refuses wrong types, values outside an enum, fractions for integers and two kinds in one entry", () => {
    const problems = checkRequests(DOCS_API, [
      { insertText: { location: { index: 1.5 }, text: 3 } },
      { updateParagraphStyle: { range: { startIndex: 1, endIndex: 2 }, paragraphStyle: { alignment: "MIDDLE" }, fields: "alignment" } },
      { insertText: { endOfSegmentLocation: {}, text: "a" }, deleteTab: { tabId: "t.1" } },
      "insertText",
    ]);
    expect(problems).toEqual([
      "requests[0].insertText.location.index: expected an integer, got 1.5",
      "requests[0].insertText.text: expected a string, got number",
      expect.stringMatching(/^requests\[1\]\.updateParagraphStyle\.paragraphStyle\.alignment: "MIDDLE" is not one of .*CENTER/),
      "requests[2]: one request kind per entry, got insertText and deleteTab",
      expect.stringMatching(/^requests\[3\]: expected an object holding one request/),
    ]);
  });

  it("requires the field mask every update request needs, and only those", () => {
    expect(checkRequests(DOCS_API, [{ updateTextStyle: { range: { startIndex: 1, endIndex: 2 }, textStyle: { bold: true } } }])).toEqual([
      expect.stringMatching(/^requests\[0\]\.updateTextStyle\.fields: required/),
    ]);
    expect(checkRequests(SHEETS_API, [{ repeatCell: { range: { sheetId: 0 }, cell: {} } }])).toEqual([expect.stringMatching(/repeatCell\.fields: required/)]);
    // Its description says the mask is used only with a new overlay position.
    expect(checkRequests(SHEETS_API, [{ updateEmbeddedObjectPosition: { objectId: 1, newPosition: { newSheet: true } } }])).toEqual([]);
  });

  it("refuses a read-only field", () => {
    const readOnly = Object.entries(SHEETS_API.schemas)
      .flatMap(([id, s]) => Object.entries(s.properties ?? {}).filter(([, p]) => p.readOnly).map(([field]) => [id, field] as const))
      .find(([id]) => id === "SheetProperties");
    expect(readOnly).toBeDefined();
    const [, field] = readOnly as readonly [string, string];
    expect(checkRequests(SHEETS_API, [{ updateSheetProperties: { properties: { sheetId: 0, [field]: {} }, fields: field } }])).toEqual([
      `requests[0].updateSheetProperties.properties.${field}: read-only, set by Google; leave it out`,
    ]);
  });

  it("answers every problem in one refusal, naming the API's revision, and sends nothing", () => {
    const failure = failureOf(() => checked(DOCS_API, [{ insertTxt: {} }, { deleteTab: { tabId: 1 } }]));
    expect(failure).toMatchObject({ kind: "input" });
    expect(failure?.message).toContain(`revision ${DOCS_API.revision}`);
    expect(failure?.message).toContain("insertTxt");
    expect(failure?.message).toContain("requests[1].deleteTab.tabId: expected a string");
  });
});

describe("the reference", () => {
  it("lists every request kind with its first sentence when no name is given", () => {
    const listed = reference(DOCS_API, "", 1);
    expect(listed).toMatchObject({ api: "docs", requests: expect.objectContaining({ insertText: "Inserts text at the specified location." }) });
  });

  it("describes a request kind with its types expanded a level down, and names the rest", () => {
    const doc = reference(DOCS_API, "updateTextStyle", 1);
    expect(doc).toMatchObject({ name: "UpdateTextStyleRequest", request: "updateTextStyle" });
    if (!("fields" in doc)) throw new Error("expected a type");
    expect(doc.fields.fields?.type).toBe("string (field mask)");
    expect(doc.fields.textStyle?.type).toBe("TextStyle");
    expect(Object.keys(doc.types)).toEqual(expect.arrayContaining(["Range", "TextStyle"]));
    expect(doc.types.TextStyle?.fields.baselineOffset?.values).toEqual(expect.objectContaining({ SUPERSCRIPT: expect.any(String) }));
    expect(doc.more).toEqual(expect.arrayContaining(["Dimension"]));
  });

  it("finds a type by any case, and suggests one for a near miss", () => {
    expect(reference(SHEETS_API, "cellformat", 0)).toMatchObject({ name: "CellFormat" });
    expect(reference(SHEETS_API, "repeatcell", 0)).toMatchObject({ name: "RepeatCellRequest", request: "repeatCell" });
    expect(reference(SLIDES_API, "createShap", 0)).toEqual({ unknown: expect.stringMatching(/did you mean createShape\?/) });
  });
});

describe("replies and styles", () => {
  it("keeps the replies that carry something, by the position of their request", () => {
    expect(repliesOf([{}, { createHeader: { headerId: "kix.h1" } }, {}, { replaceAllText: { occurrencesChanged: 3 } }])).toEqual([
      { request: 1, createHeader: { headerId: "kix.h1" } },
      { request: 3, replaceAllText: { occurrencesChanged: 3 } },
    ]);
    expect(repliesOf(undefined)).toEqual([]);
  });

  it("writes lengths and colours short and drops what is empty", () => {
    expect(
      compact({
        fontSize: { magnitude: 11, unit: "PT" },
        foregroundColor: { color: { rgbColor: { red: 0.1, green: 0.45, blue: 0.91 } } },
        backgroundColor: {},
        sheetsColor: { red: 1, green: 0.5 },
        width: { unit: "PT" },
        weightedFontFamily: { fontFamily: "Inter", weight: 400 },
        nothing: [{}],
      }),
    ).toEqual({ fontSize: "11pt", foregroundColor: "#1a73e8", sheetsColor: "#ff8000", width: "0pt", weightedFontFamily: { fontFamily: "Inter", weight: 400 } });
  });

  it("suggests by case first, then by edit distance, else the short list", () => {
    expect(suggestion("TEXTSTYLE", ["textStyle", "range"])).toBe("; did you mean textStyle?");
    expect(suggestion("zzzzzz", ["a", "b"])).toBe("; it takes a, b");
  });
});
