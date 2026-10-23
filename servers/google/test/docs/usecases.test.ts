import { describe, expect, it } from "vitest";

import type { Deps } from "../../src/docs/app/ports.js";
import { readDocument } from "../../src/docs/app/usecases/read.js";
import { appendToDocument, createDocument, editSection } from "../../src/docs/app/usecases/write.js";
import { apiError, asAppError, fail } from "../../src/docs/domain/errors.js";
import type { RawDocument } from "../../src/docs/domain/schema.js";
import type { Deps as DriveDeps, DrivePort } from "../../src/drive/app/ports.js";
import { makeSimulator } from "./simulator.js";

/**
 * The Docs use cases over the simulator: a get returns what the simulator
 * holds, a batchUpdate applies to it after checking the pinned revision, the
 * way Docs does.
 */
const fakes = (fillFails = false) => {
  const sim = makeSimulator([
    { text: "Plan", named: "HEADING_1" },
    { text: "old" },
    { text: "Risks", named: "HEADING_1" },
    { text: "none" },
  ]);
  const created: string[] = [];
  let revision = 1;
  const deps: Deps = {
    account: "work",
    docs: {
      get: async () => ({ ...(sim.document() as RawDocument), revisionId: `r${revision}` }),
      batchUpdate: async (_, requests, pinned) => {
        if (fillFails) return fail(apiError(500, "Docs is down"));
        if (pinned !== `r${revision}`) return fail(apiError(400, "revision moved"));
        sim.applyAll(requests);
        revision += 1;
        return `r${revision}`;
      },
      apply: async (_, requests, pin) => {
        if (pin.requiredRevisionId && pin.requiredRevisionId !== `r${revision}`) {
          return fail(apiError(400, "The required revision ID does not match the latest revision"));
        }
        sim.applyAll(requests as Parameters<typeof sim.applyAll>[0]);
        revision += 1;
        return { documentId: "doc1", replies: requests.map(() => ({})), writeControl: { requiredRevisionId: `r${revision}` } };
      },
    },
    drive: {
      drive: {
        createFile: async (name: string, mimeType: string, parent: string) => {
          created.push(`${name}|${mimeType}|${parent}`);
          return { id: "new1", name, mimeType, webViewLink: "https://docs.google.com/document/d/new1/edit" };
        },
      } as unknown as DrivePort,
      grant: () => ({ source: "fake", detail: "" }),
    } as DriveDeps,
  };
  return { deps, sim, created };
};

const failureOf = async (p: Promise<unknown>) => asAppError(await p.then(() => undefined, (e: unknown) => e));

const edit = { documentId: "doc1", clear: false, dropHidden: false };

/** The simulator's document with an image in the paragraph under "Plan", which markdown cannot carry. */
const withImage = (deps: Deps): Deps => ({
  ...deps,
  docs: {
    ...deps.docs,
    get: async (id) => {
      const doc = structuredClone(await deps.docs.get(id)) as { body: { content: { startIndex?: number; paragraph?: { elements: unknown[] } }[] } };
      const under = doc.body.content.filter((e) => e.paragraph)[1];
      under?.paragraph?.elements.unshift({ startIndex: under.startIndex, inlineObjectElement: { inlineObjectId: "kix.1" } });
      return doc as RawDocument;
    },
  },
});

describe("read_document", () => {
  it("returns the whole section index, the markdown of one section, and the revision", async () => {
    const { deps } = fakes();
    const read = await readDocument(deps, { documentId: "https://docs.google.com/document/d/doc1/edit", section: "Risks", maxChars: 60_000 });
    expect(read).toMatchObject({ documentId: "doc1", revisionId: "r1", section: "Risks", markdown: "# Risks\n\nnone", truncated: false });
    expect(read.sections.map((s) => s.path)).toEqual(["Plan", "Risks"]);
  });

  it("cuts at max_chars and says so", async () => {
    const { deps } = fakes();
    expect(await readDocument(deps, { documentId: "doc1", section: "", maxChars: 10 })).toMatchObject({ markdown: "# Plan\n\nol", truncated: true });
  });
});

describe("the writes", () => {
  it("edits a section in one batch pinned to the revision it read, and returns the new revision", async () => {
    const { deps } = fakes();
    expect(await editSection(deps, { ...edit, section: "Plan", markdown: "- a\n- b", expectedRevision: "r1" })).toMatchObject({
      revisionId: "r2",
      section: "Plan",
      before: { chars: 3 },
      after: { chars: 7 },
    });
    expect((await readDocument(deps, { documentId: "doc1", section: "", maxChars: 60_000 })).markdown).toBe("# Plan\n\n- a\n- b\n\n# Risks\n\nnone");
  });

  it("refuses an edit expecting a revision the document has moved past, before sending anything", async () => {
    const { deps } = fakes();
    expect(await failureOf(editSection(deps, { ...edit, section: "Plan", markdown: "x", expectedRevision: "r0" }))).toMatchObject({
      kind: "api",
      status: 409,
      reason: "stale_revision",
    });
  });

  it("refuses an edit that does not say which revision it read, and an empty body without clear", async () => {
    const { deps } = fakes();
    expect(await failureOf(editSection(deps, { ...edit, section: "Plan", markdown: "x", expectedRevision: "" }))).toMatchObject({ kind: "input" });
    expect(await failureOf(editSection(deps, { ...edit, section: "Plan", markdown: " ", expectedRevision: "r1" }))).toMatchObject({
      kind: "input",
      message: expect.stringMatching(/clear: true/),
    });
    expect(await editSection(deps, { ...edit, section: "Plan", markdown: "", expectedRevision: "r1", clear: true })).toMatchObject({ after: { chars: 0 } });
  });

  it("refuses to replace a section holding what the read does not show, unless told it may go", async () => {
    const { deps } = fakes();
    const imaged = withImage(deps);
    expect(await readDocument(imaged, { documentId: "doc1", section: "Plan", maxChars: 60_000 })).toMatchObject({ notShown: "1 image" });
    expect(await failureOf(editSection(imaged, { ...edit, section: "Plan", markdown: "new", expectedRevision: "r1" }))).toMatchObject({
      kind: "input",
      message: expect.stringMatching(/holds 1 image/),
    });
    expect(await editSection(imaged, { ...edit, section: "Risks", markdown: "new", expectedRevision: "r1" })).toMatchObject({ revisionId: "r2" });
    expect(await editSection(imaged, { ...edit, section: "Plan", markdown: "new", expectedRevision: "r2", dropHidden: true })).toMatchObject({ dropped: "1 image" });
  });

  it("appends after the last paragraph", async () => {
    const { deps } = fakes();
    await appendToDocument(deps, { documentId: "doc1", markdown: "## Next\n\nmore", expectedRevision: "" });
    expect((await readDocument(deps, { documentId: "doc1", section: "Risks", maxChars: 60_000 })).markdown).toBe("# Risks\n\nnone\n\n## Next\n\nmore");
  });

  it("creates the document in its folder through Drive, then fills it", async () => {
    const { deps, created } = fakes();
    expect(await createDocument(deps, { title: "Memo", markdown: "hi", folderId: "F1", folderPath: "" })).toMatchObject({
      documentId: "new1",
      link: "https://docs.google.com/document/d/new1/edit",
    });
    expect(created).toEqual(["Memo|application/vnd.google-apps.document|F1"]);
  });

  it("names the document it made when filling it fails, so nobody makes a second one", async () => {
    const { deps } = fakes(true);
    expect(await failureOf(createDocument(deps, { title: "Memo", markdown: "hi", folderId: "", folderPath: "" }))).toMatchObject({
      message: expect.stringMatching(/document new1 was created but not finished/),
    });
  });
});
