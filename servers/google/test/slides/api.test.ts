/**
 * Slides' full API: the deck's structure with every object id, and a batch of
 * any requests checked against the schema before it is sent.
 */
import { describe, expect, it } from "vitest";

import type { Deps as DriveDeps, DrivePort } from "../../src/drive/app/ports.js";
import type { Deps, SlidesPort } from "../../src/slides/app/ports.js";
import { batchUpdatePresentation, createPresentation, getPresentation } from "../../src/slides/app/usecases/api.js";
import { apiError, asAppError, fail, STALE_REVISION } from "../../src/slides/domain/errors.js";
import type { RawPresentation } from "../../src/slides/domain/schema.js";
import { presentationOutline } from "../../src/slides/domain/structure.js";

const failureOf = async (p: Promise<unknown>) => asAppError(await p.then(() => undefined, (e: unknown) => e));

const DECK: RawPresentation = {
  presentationId: "P1",
  title: "Pitch",
  revisionId: "rv1",
  pageSize: { width: { magnitude: 9144000, unit: "EMU" }, height: { magnitude: 5143500, unit: "EMU" } },
  layouts: [{ objectId: "L1", layoutProperties: { name: "TITLE_AND_BODY", displayName: "Title and body", masterObjectId: "M1" } }],
  masters: [{ objectId: "M1", masterProperties: { displayName: "Simple" } }],
  slides: [
    {
      objectId: "s1",
      slideProperties: { layoutObjectId: "L1", notesPage: { notesProperties: { speakerNotesObjectId: "n1" }, pageElements: [{ objectId: "n1", shape: { text: { textElements: [{ textRun: { content: "Hi\n" } }] } } }] } },
      pageElements: [
        {
          objectId: "t1",
          size: { width: { magnitude: 3000000, unit: "EMU" }, height: { magnitude: 400000, unit: "EMU" } },
          transform: { scaleX: 1, scaleY: 1, translateX: 311700, translateY: 744575, unit: "EMU" },
          shape: { shapeType: "TEXT_BOX", placeholder: { type: "TITLE", parentObjectId: "L1t" }, text: { textElements: [{ paragraphMarker: {} }, { textRun: { content: "Agenda\n" } }] } },
        },
        { objectId: "i1", image: { sourceUrl: "https://example.com/a.png", contentUrl: "https://lh3/temporary" } },
        { objectId: "tb", table: { rows: 1, columns: 2, tableRows: [{ tableCells: [{ text: { textElements: [{ textRun: { content: "a\n" } }] } }, { columnSpan: 1 }] }] } },
        { objectId: "g1", elementGroup: { children: [{ objectId: "l1", line: { lineCategory: "STRAIGHT", lineType: "STRAIGHT_LINE" } }] } },
        { objectId: "c1", sheetsChart: { spreadsheetId: "S1", chartId: 42 } },
      ],
    },
    { objectId: "s2", slideProperties: { layoutObjectId: "L1", isSkipped: true }, pageElements: [] },
  ],
};

describe("the outline", () => {
  it("gives every element's id, kind, size and exact text, the notes' shape and the layouts", () => {
    const out = presentationOutline(DECK, { slideIds: [], fromSlide: 0, maxChars: 60_000 }) as Record<string, any>;
    expect(out).toMatchObject({ presentationId: "P1", revisionId: "rv1", slideCount: 2, pageSize: { width: "9144000 EMU" }, truncated: false });
    expect(out.layouts).toEqual([{ objectId: "L1", name: "TITLE_AND_BODY", displayName: "Title and body", masterObjectId: "M1" }]);
    const [first, second] = out.slides;
    expect(first.notes).toEqual({ speakerNotesObjectId: "n1", text: "Hi\n" });
    expect(first.elements.map((e: { objectId: string; type: string }) => [e.objectId, e.type])).toEqual([
      ["t1", "shape"],
      ["i1", "image"],
      ["tb", "table"],
      ["g1", "group"],
      ["c1", "sheetsChart"],
    ]);
    expect(first.elements[0]).toMatchObject({ shapeType: "TEXT_BOX", placeholder: { type: "TITLE", parentObjectId: "L1t" }, text: "Agenda\n", size: { width: "3000000 EMU" } });
    expect(first.elements[1]).toEqual({ objectId: "i1", type: "image", sourceUrl: "https://example.com/a.png" });
    expect(first.elements[2].cells).toEqual([[{ text: "a\n" }, {}]]);
    expect(first.elements[3].children).toEqual([{ objectId: "l1", type: "line", lineCategory: "STRAIGHT", lineType: "STRAIGHT_LINE" }]);
    expect(second).toMatchObject({ objectId: "s2", index: 1, skipped: true, elements: [] });
  });

  it("selects slides by id, starts where a cut one left off, and cuts at a slide", () => {
    expect((presentationOutline(DECK, { slideIds: ["s2"], fromSlide: 0, maxChars: 60_000 }).slides as unknown[]).length).toBe(1);
    expect(presentationOutline(DECK, { slideIds: [], fromSlide: 1, maxChars: 60_000 })).toMatchObject({ slides: [{ objectId: "s2" }] });
    expect(presentationOutline(DECK, { slideIds: [], fromSlide: 0, maxChars: 100 })).toMatchObject({ truncated: true, nextSlide: 1, slides: [{ objectId: "s1" }] });
  });
});

describe("the batch", () => {
  const fakes = (answer: () => Promise<any>) => {
    const sent: unknown[][] = [];
    const slides = {
      get: async () => DECK,
      apply: async (...args: unknown[]) => {
        sent.push(args);
        return answer();
      },
    } as unknown as SlidesPort;
    return { deps: { account: "work", slides, drive: {} as DriveDeps, nonce: () => "n" } as Deps, sent };
  };

  it("sends checked requests, pinned when asked, and returns the replies with ids", async () => {
    const { deps, sent } = fakes(async () => ({ presentationId: "P1", replies: [{ createSlide: { objectId: "s9" } }, {}], writeControl: { requiredRevisionId: "rv2" } }));
    const requests = [
      { createSlide: { objectId: "slide_nine", slideLayoutReference: { predefinedLayout: "BLANK" } } },
      { insertText: { objectId: "t1", insertionIndex: 0, text: "Q3 " } },
    ];
    expect(await batchUpdatePresentation(deps, { presentationId: "P1", requests, expectedRevision: "rv1", images: {} })).toEqual({
      presentationId: "P1",
      link: "https://docs.google.com/presentation/d/P1/edit",
      revisionId: "rv2",
      applied: 2,
      replies: [{ request: 0, createSlide: { objectId: "s9" } }],
    });
    expect(sent).toEqual([["P1", requests, "rv1"]]);
  });

  it("refuses an unknown enum value before sending, and calls a moved-on revision stale", async () => {
    const { deps, sent } = fakes(async () => fail(apiError(400, "Google Slides rejected POST", { body: { error: { message: "The required revision ID 'rv0' does not match the latest revision." } } })));
    expect(await failureOf(batchUpdatePresentation(deps, { presentationId: "P1", requests: [{ createSlide: { slideLayoutReference: { predefinedLayout: "HUGE" } } }], expectedRevision: "", images: {} }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining('"HUGE" is not one of'),
    });
    expect(sent).toHaveLength(0);
    expect(await failureOf(batchUpdatePresentation(deps, { presentationId: "P1", requests: [{ deleteObject: { objectId: "t1" } }], expectedRevision: "rv0", images: {} }))).toMatchObject({
      reason: STALE_REVISION,
    });
  });

  it("reads raw with a field mask, refusing one over the budget", async () => {
    const { deps } = fakes(async () => ({}));
    expect(await getPresentation(deps, { presentationId: "P1", format: "raw", slideIds: [], fromSlide: 0, fields: "slides(objectId)", maxChars: 60_000 })).toMatchObject({
      presentation: { presentationId: "P1" },
    });
    expect(await failureOf(getPresentation(deps, { presentationId: "P1", format: "raw", slideIds: [], fromSlide: 0, fields: "", maxChars: 50 }))).toMatchObject({ kind: "input" });
  });
});

describe("a blank deck", () => {
  it("is made by Drive in its folder, and named with the title slide Slides gives it", async () => {
    const created: string[] = [];
    const drive = {
      createFile: async (name: string, mimeType: string, parent: string) => {
        created.push(`${name}|${mimeType}|${parent}`);
        return { id: "P9", name, mimeType, webViewLink: "https://docs.google.com/presentation/d/P9/edit" };
      },
    } as unknown as DrivePort;
    const fields: unknown[] = [];
    const slides = { get: async (_: string, f?: string) => (fields.push(f), { presentationId: "P9", revisionId: "rv1", slides: [{ objectId: "p" }] }) } as unknown as SlidesPort;
    const deps = { account: "work", slides, drive: { drive, grant: () => ({ source: "fake", detail: "" }) } as DriveDeps, nonce: () => "n" } as Deps;
    expect(await createPresentation(deps, { title: "Pitch", folderId: "F1", folderPath: "" })).toEqual({
      presentationId: "P9",
      title: "Pitch",
      link: "https://docs.google.com/presentation/d/P9/edit",
      revisionId: "rv1",
      slides: ["p"],
    });
    expect(created).toEqual(["Pitch|application/vnd.google-apps.presentation|F1"]);
    expect(fields).toEqual(["presentationId,revisionId,slides(objectId)"]);
  });
});
