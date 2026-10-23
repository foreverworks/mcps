import { describe, expect, it } from "vitest";

import type { Deps as DriveDeps, DrivePort } from "../../src/drive/app/ports.js";
import type { Deps, SlidesPort } from "../../src/slides/app/ports.js";
import { createDeckFromOutline, fillPlaceholders } from "../../src/slides/app/usecases/write.js";
import { layoutsOf, slidesOf } from "../../src/slides/domain/deck.js";
import { asAppError, type AppError } from "../../src/slides/domain/errors.js";
import { buildOutline, notesRequests, tag } from "../../src/slides/domain/outline.js";
import type { RawPresentation, SlidesRequest } from "../../src/slides/domain/schema.js";

const shape = (objectId: string, type: string | undefined, text: string) => ({
  objectId,
  shape: {
    ...(type ? { placeholder: { type, index: 0 } } : {}),
    text: { textElements: text.split("\n").map((line) => ({ textRun: { content: `${line}\n` } })) },
  },
});

const TEMPLATE: RawPresentation = {
  presentationId: "tpl",
  title: "Template",
  revisionId: "r1",
  layouts: [
    {
      objectId: "L_title",
      layoutProperties: { name: "TITLE", displayName: "Title slide" },
      pageElements: [shape("lt", "CENTERED_TITLE", ""), shape("ls", "SUBTITLE", "")],
    },
    {
      objectId: "L_body",
      layoutProperties: { name: "TITLE_AND_BODY", displayName: "Title and body" },
      pageElements: [shape("bt", "TITLE", ""), shape("bb", "BODY", "")],
    },
  ],
  slides: [
    {
      objectId: "s1",
      slideProperties: {
        layoutObjectId: "L_body",
        notesPage: { notesProperties: { speakerNotesObjectId: "n1" }, pageElements: [shape("n1", "BODY", "Say hello")] },
      },
      pageElements: [
        shape("t1", "TITLE", "Agenda"),
        { objectId: "g", elementGroup: { children: [shape("b1", "BODY", "One\nTwo")] } },
        { objectId: "tb", table: { tableRows: [{ tableCells: [{ text: { textElements: [{ textRun: { content: "a\n" } }] } }, { text: { textElements: [{ textRun: { content: "b\n" } }] } }] }] } },
      ],
    },
  ],
};

const thrownBy = async (fn: () => Promise<unknown> | unknown): Promise<AppError> => {
  try {
    await fn();
  } catch (e) {
    const error = asAppError(e);
    if (error) return error;
    throw e;
  }
  throw new Error("expected a failure");
};

describe("reading a deck", () => {
  it("lists each layout's placeholders", () => {
    expect(layoutsOf(TEMPLATE).map((l) => [l.displayName, l.placeholders.map((p) => p.type)])).toEqual([
      ["Title slide", ["CENTERED_TITLE", "SUBTITLE"]],
      ["Title and body", ["TITLE", "BODY"]],
    ]);
  });

  it("reads the title, the other texts (inside groups, tables as rows) and the speaker notes", () => {
    expect(slidesOf(TEMPLATE)).toEqual([
      { index: 0, objectId: "s1", layout: "Title and body", title: "Agenda", texts: ["One\nTwo", "a | b"], notes: "Say hello" },
    ]);
  });
});

describe("an outline as one batch", () => {
  const layouts = layoutsOf(TEMPLATE);

  it("creates each slide from its layout with our ids on its placeholders, fills them, then deletes the old slides", () => {
    const built = buildOutline(
      layouts,
      [
        { layout: "title slide", title: "Q3", subtitle: "Review" },
        { layout: "TITLE_AND_BODY", title: "Numbers", body: ["Up", "Right"], notes: "Mention churn" },
      ],
      ["s1"],
      { nonce: "abc12", keepExisting: false },
    );
    expect(built.requests[0]).toEqual({
      createSlide: {
        objectId: "abc12_0_slide",
        insertionIndex: 1,
        slideLayoutReference: { layoutId: "L_title" },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: "CENTERED_TITLE", index: 0 }, objectId: "abc12_0_title" },
          { layoutPlaceholder: { type: "SUBTITLE", index: 0 }, objectId: "abc12_0_subtitle" },
        ],
      },
    });
    expect(built.requests.map((r) => Object.keys(r)[0])).toEqual(["createSlide", "insertText", "insertText", "createSlide", "insertText", "insertText", "deleteObject"]);
    expect(built.requests[5]).toEqual({ insertText: { objectId: "abc12_1_body", insertionIndex: 0, text: "Up\nRight" } });
    expect(built.slides).toEqual([{ objectId: "abc12_0_slide" }, { objectId: "abc12_1_slide", notes: "Mention churn" }]);
  });

  it("keeps the template's slides when asked", () => {
    const built = buildOutline(layouts, [{ layout: "Title slide", title: "x" }], ["s1"], { nonce: "abc12", keepExisting: true });
    expect(built.requests.some((r) => r.deleteObject)).toBe(false);
  });

  it("refuses an unknown layout, and a field the layout has no placeholder for", async () => {
    expect(await thrownBy(() => buildOutline(layouts, [{ layout: "Blank" }], [], { nonce: "abc12", keepExisting: false }))).toMatchObject({
      kind: "input",
      message: expect.stringMatching(/layouts: Title slide, Title and body/),
    });
    expect(await thrownBy(() => buildOutline(layouts, [{ layout: "Title slide", body: "x" }], [], { nonce: "abc12", keepExisting: false }))).toMatchObject({
      kind: "input",
      message: expect.stringMatching(/no body placeholder/),
    });
  });

  it("writes notes into the shapes Slides gave the new slides", () => {
    const after: RawPresentation = { slides: [{ objectId: "abc12_1_slide", slideProperties: { notesPage: { notesProperties: { speakerNotesObjectId: "N9" } } } }] };
    expect(notesRequests(after, [{ objectId: "abc12_1_slide", notes: "hi" }])).toEqual([{ insertText: { objectId: "N9", insertionIndex: 0, text: "hi" } }]);
  });

  it("wraps a bare key as a {{tag}} and leaves a wrapped one alone", () => {
    expect([tag("client"), tag("{{client}}")]).toEqual(["{{client}}", "{{client}}"]);
  });
});

describe("the use cases", () => {
  const fakes = (deck: RawPresentation = TEMPLATE) => {
    const calls: { copies: string[]; batches: (readonly SlidesRequest[])[]; revisions: (string | undefined)[] } = { copies: [], batches: [], revisions: [] };
    const slides: SlidesPort = {
      // The copy, as Slides would show it: after the first batch, the new slide is there with its notes shape.
      get: async (id) =>
        id === "tpl"
          ? deck
          : {
              ...deck,
              presentationId: id,
              revisionId: `rev-${calls.batches.length}`,
              ...(calls.batches.length > 0
                ? { slides: [{ objectId: "nonce1_0_slide", slideProperties: { notesPage: { notesProperties: { speakerNotesObjectId: "N1" } } } }] }
                : {}),
            },
      batchUpdate: async (_, requests, revision) => {
        calls.batches.push(requests);
        calls.revisions.push(revision);
        return { replies: requests.map((_, i) => ({ replaceAllText: { occurrencesChanged: i === 0 ? 2 : 0 } })) };
      },
      apply: async (_, requests, revision) => {
        calls.batches.push(requests);
        calls.revisions.push(revision);
        return { replies: requests.map((_, i) => ({ replaceAllText: { occurrencesChanged: i === 0 ? 2 : 0 } })) };
      },
      thumbnail: async () => ({ contentUrl: "https://x/thumb.png", width: 800, height: 450 }),
    };
    const drive = {
      copy: async (id: string, name: string, parent: string) => {
        calls.copies.push(`${id}->${name}@${parent}`);
        return { id: "deck2", name, mimeType: "application/vnd.google-apps.presentation", webViewLink: "https://docs.google.com/presentation/d/deck2/edit" };
      },
    } as unknown as DrivePort;
    const deps: Deps = { account: "work", slides, drive: { drive, grant: () => ({ source: "fake", detail: "" }) } as DriveDeps, nonce: () => "nonce1" };
    return { deps, calls };
  };

  it("checks the outline against the template before copying anything", async () => {
    const { deps, calls } = fakes();
    const error = await thrownBy(() =>
      createDeckFromOutline(deps, { templateId: "tpl", title: "New", outline: [{ layout: "Nope" }], keepTemplateSlides: false, folderId: "", folderPath: "" }),
    );
    expect(error.kind).toBe("input");
    expect(calls.copies).toEqual([]);
  });

  it("copies the template into the folder, builds the slides pinned to the copy's revision, then writes notes", async () => {
    const { deps, calls } = fakes();
    const made = await createDeckFromOutline(deps, {
      templateId: "https://docs.google.com/presentation/d/tpl/edit",
      title: "New",
      outline: [{ layout: "Title and body", title: "T", notes: "N" }],
      keepTemplateSlides: false,
      folderId: "F1",
      folderPath: "",
    });
    expect(calls.copies).toEqual(["tpl->New@F1"]);
    expect(calls.batches).toHaveLength(2);
    expect(calls.revisions).toEqual(["rev-0", "rev-1"]);
    expect(calls.batches[1]).toEqual([{ insertText: { objectId: "N1", insertionIndex: 0, text: "N" } }]);
    expect(made).toMatchObject({ presentationId: "deck2", slides: 1, templateSlidesDeleted: 1 });
  });

  it("reports how many of each tag were replaced, and which were not found", async () => {
    const { deps } = fakes();
    expect(await fillPlaceholders(deps, { presentationId: "d", values: { client: "Acme", missing: "x" }, slideIds: [] })).toEqual({
      presentationId: "d",
      replaced: { "{{client}}": 2, "{{missing}}": 0 },
      notFound: ["{{missing}}"],
    });
  });
});
