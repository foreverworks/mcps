/**
 * The index arithmetic, run rather than read: every write is applied to the
 * simulator (a model of Docs' index space that refuses what Docs refuses),
 * and the document it leaves is read back through the same reader the tools
 * use. A request list that is off by one shows up as text in the wrong place,
 * or as the simulator refusing the request outright.
 */
import { describe, expect, it } from "vitest";

import { appendMarkdown, replaceSection } from "../../src/docs/domain/edit.js";
import { asAppError } from "../../src/docs/domain/errors.js";
import { type DocModel, readDocument } from "../../src/docs/domain/fromDocs.js";
import { findSection, sectionsOf } from "../../src/docs/domain/sections.js";
import type { RawDocument } from "../../src/docs/domain/schema.js";
import { toMarkdown } from "../../src/docs/domain/toMarkdown.js";
import { makeSimulator, type Spec } from "./simulator.js";

const FULL = [
  "# Plan",
  "Intro with **bold**, *italic*, ~~gone~~, `code` and a [link](https://x.io/a).",
  "## Steps",
  "1. first\n   1. detail\n      1. deeper\n2. second",
  "- bullet\n  - another",
  "```\nline 1\nline 2\n```",
  "| Col | Other |\n| --- | --- |\n| a \\| b | *x*<br>y |",
  "After the table.",
].join("\n\n");

const modelOf = (sim: ReturnType<typeof makeSimulator>): DocModel => readDocument(sim.document() as RawDocument);
const markdownOf = (sim: ReturnType<typeof makeSimulator>): string => toMarkdown(modelOf(sim).blocks);

const OUTLINE: readonly Spec[] = [
  { text: "A", named: "HEADING_1" },
  { text: "old a" },
  { text: "A1", named: "HEADING_2" },
  { text: "old a1" },
  { text: "B", named: "HEADING_1" },
  { text: "b" },
];

const edit = (specs: readonly Spec[], section: string, markdown: string) => {
  const sim = makeSimulator(specs);
  const model = modelOf(sim);
  sim.applyAll(replaceSection(model, findSection(sectionsOf(model.blocks), section), markdown));
  return sim;
};

describe("a new document, filled from markdown", () => {
  it("reads back as the markdown it was made from: headings, nested lists, code, links, a table", () => {
    const sim = makeSimulator([]);
    sim.applyAll(appendMarkdown(modelOf(sim), FULL));
    expect(markdownOf(sim)).toBe(FULL);
  });

  // Docs sets a list's glyphs per preset, for every level at once, and the API has no request that
  // changes one level's glyph: a bullet under a number comes out as a sub-number (a., b.).
  it("numbers every level of a list whose top level is numbered", () => {
    const sim = makeSimulator([]);
    sim.applyAll(appendMarkdown(modelOf(sim), "1. first\n   - detail"));
    expect(markdownOf(sim)).toBe("1. first\n   1. detail");
  });

  it("takes over the new document's empty paragraph instead of leaving a blank line", () => {
    const sim = makeSimulator([]);
    sim.applyAll(appendMarkdown(modelOf(sim), "one\n\ntwo"));
    expect(sim.text()).toBe("one\ntwo\n");
  });

  it("ends a document whose last block is a table with the paragraph Docs requires after it", () => {
    const sim = makeSimulator([]);
    sim.applyAll(appendMarkdown(modelOf(sim), "| a | b |\n|---|---|\n| 1 | 2 |"));
    expect(sim.text()).toBe("\n[tableStart][rowStart][cellStart]a\n[cellStart]b\n[rowStart][cellStart]1\n[cellStart]2\n[tableEnd]\n");
    expect(markdownOf(sim)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });
});

describe("append_to_document", () => {
  it("starts a paragraph of its own after a last paragraph that has text", () => {
    const sim = makeSimulator([{ text: "Existing", named: "HEADING_1" }, { text: "last line" }]);
    sim.applyAll(appendMarkdown(modelOf(sim), "- added\n  - nested"));
    expect(markdownOf(sim)).toBe("# Existing\n\nlast line\n\n- added\n  - nested");
  });

  it("does not inherit the style of the paragraph it follows", () => {
    const sim = makeSimulator([{ text: "Heading last", named: "HEADING_2" }]);
    sim.applyAll(appendMarkdown(modelOf(sim), "plain"));
    expect(markdownOf(sim)).toBe("## Heading last\n\nplain");
  });
});

describe("edit_document_section", () => {
  it("replaces a middle section, subsections included, and leaves the next heading and its id alone", () => {
    const before = modelOf(makeSimulator(OUTLINE));
    const idOfB = sectionsOf(before.blocks).find((s) => s.title === "B")?.id;
    const sim = edit(OUTLINE, "A", "new body\n\n## New sub\n\n- x\n- y");
    expect(markdownOf(sim)).toBe("# A\n\nnew body\n\n## New sub\n\n- x\n- y\n\n# B\n\nb");
    expect(sectionsOf(modelOf(sim).blocks).find((s) => s.title === "B")?.id).toBe(idOfB);
  });

  it("replaces a subsection by its path", () => {
    expect(markdownOf(edit(OUTLINE, "A > A1", "**replaced**"))).toBe("# A\n\nold a\n\n## A1\n\n**replaced**\n\n# B\n\nb");
  });

  it("replaces the last section up to the newline Docs never lets go", () => {
    expect(markdownOf(edit(OUTLINE, "B", "1. one\n2. two"))).toBe("# A\n\nold a\n\n## A1\n\nold a1\n\n# B\n\n1. one\n2. two");
  });

  it("fills a section whose heading is the document's last paragraph", () => {
    expect(markdownOf(edit([{ text: "Intro" }, { text: "End", named: "HEADING_1" }], "End", "filled"))).toBe("Intro\n\n# End\n\nfilled");
  });

  it("empties a section when given nothing", () => {
    expect(markdownOf(edit(OUTLINE, "A", ""))).toBe("# A\n\n# B\n\nb");
  });

  it("puts a table first in a section and text after it", () => {
    expect(markdownOf(edit(OUTLINE, "A1", "| k | v |\n| --- | --- |\n| 1 | 2 |\n\nafter"))).toBe(
      "# A\n\nold a\n\n## A1\n\n| k | v |\n| --- | --- |\n| 1 | 2 |\n\nafter\n\n# B\n\nb",
    );
  });

  it("replaces a section that holds a table, deleting the whole table", () => {
    const sim = makeSimulator(OUTLINE);
    sim.applyAll(replaceSection(modelOf(sim), findSection(sectionsOf(modelOf(sim).blocks), "A1"), "text\n\n| t | u |\n|---|---|\n| 1 | 2 |"));
    const model = modelOf(sim);
    sim.applyAll(replaceSection(model, findSection(sectionsOf(model.blocks), "A1"), "just text"));
    expect(markdownOf(sim)).toBe("# A\n\nold a\n\n## A1\n\njust text\n\n# B\n\nb");
  });

  it("refuses a heading that would end the section early", () => {
    const sim = makeSimulator(OUTLINE);
    const model = modelOf(sim);
    const thrown = (() => {
      try {
        replaceSection(model, findSection(sectionsOf(model.blocks), "A1"), "## Sibling");
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(asAppError(thrown)).toMatchObject({ kind: "input", message: expect.stringMatching(/use level 3 or deeper/) });
  });
});

describe("sections", () => {
  const model = modelOf(makeSimulator([...OUTLINE, { text: "A1", named: "HEADING_2" }]));
  const sections = sectionsOf(model.blocks);

  it("indexes every heading with its path", () => {
    expect(sections.map((s) => s.path.join(" > "))).toEqual(["A", "A > A1", "B", "B > A1"]);
  });

  it("finds by id, by path and by a unique title, and calls a shared title ambiguous", () => {
    const b = sections[2];
    expect(findSection(sections, b?.id ?? "").title).toBe("B");
    expect(findSection(sections, "b > a1").path).toEqual(["B", "A1"]);
    expect(findSection(sections, "A").title).toBe("A");
    const thrown = (() => {
      try {
        return findSection(sections, "A1");
      } catch (e) {
        return e;
      }
    })();
    expect(asAppError(thrown)).toMatchObject({ kind: "ambiguous", candidates: [expect.stringMatching(/A > A1$/), expect.stringMatching(/B > A1$/)] });
  });
});
