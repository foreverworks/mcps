import { describe, expect, it } from "vitest";

import type { Block } from "../../src/docs/domain/blocks.js";
import { parseInline } from "../../src/docs/domain/edit/parseMarkdown/inline.js";
import { parseMarkdown } from "../../src/docs/domain/edit/parseMarkdown.js";
import { toMarkdown } from "../../src/docs/domain/toMarkdown.js";

const md = (blocks: readonly Block[]): string => toMarkdown(blocks.map((block) => ({ block })));

describe("parseInline", () => {
  it("reads bold, italic, both, strike and code", () => {
    expect(parseInline("a **b** *c* ***d*** ~~e~~ `f`")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", bold: true, italic: true },
      { text: " " },
      { text: "e", strike: true },
      { text: " " },
      { text: "f", code: true },
    ]);
  });

  it("nests italic inside bold, closing a longer run with its last characters", () => {
    expect(parseInline("**a *b***")).toEqual([
      { text: "a ", bold: true },
      { text: "b", bold: true, italic: true },
    ]);
  });

  it("reads links, styled link text, autolinks and bare URLs", () => {
    expect(parseInline("see [the **plan**](https://x.io/a_(b)) or <https://y.io> or https://z.io/p.")).toEqual([
      { text: "see " },
      { text: "the ", link: "https://x.io/a_(b)" },
      { text: "plan", bold: true, link: "https://x.io/a_(b)" },
      { text: " or " },
      { text: "https://y.io", link: "https://y.io" },
      { text: " or " },
      { text: "https://z.io/p", link: "https://z.io/p" },
      { text: "." },
    ]);
  });

  it("leaves what does not close as literal text, and snake_case alone", () => {
    expect(parseInline("2 * 3 and **open and snake_case_name")).toEqual([{ text: "2 * 3 and **open and snake_case_name" }]);
  });

  it("honours escapes and keeps markup inside code literal", () => {
    expect(parseInline("\\*not\\* `**raw**`")).toEqual([{ text: "*not* " }, { text: "**raw**", code: true }]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs joined across lines, and drops rules", () => {
    expect(parseMarkdown("# Title\n\nline one\nline two\n\n---\n\n### Deep ###\n")).toEqual([
      { kind: "heading", level: 1, inlines: [{ text: "Title" }] },
      { kind: "paragraph", inlines: [{ text: "line one line two" }] },
      { kind: "heading", level: 3, inlines: [{ text: "Deep" }] },
    ]);
  });

  it("nests list items by indentation, whatever the indent width", () => {
    const two = parseMarkdown("- a\n  - b\n    - c\n- d");
    const four = parseMarkdown("- a\n    - b\n        - c\n- d");
    const expected = [
      { kind: "item", ordered: false, depth: 0, inlines: [{ text: "a" }] },
      { kind: "item", ordered: false, depth: 1, inlines: [{ text: "b" }] },
      { kind: "item", ordered: false, depth: 2, inlines: [{ text: "c" }] },
      { kind: "item", ordered: false, depth: 0, inlines: [{ text: "d" }] },
    ];
    expect(two).toEqual(expected);
    expect(four).toEqual(expected);
  });

  it("reads numbered lists, bullets under numbers, continuations and loose lists", () => {
    expect(parseMarkdown("1. first\n   carried on\n   - sub\n\n2. second")).toEqual([
      { kind: "item", ordered: true, depth: 0, inlines: [{ text: "first carried on" }] },
      { kind: "item", ordered: false, depth: 1, inlines: [{ text: "sub" }] },
      { kind: "item", ordered: true, depth: 0, inlines: [{ text: "second" }] },
    ]);
  });

  it("reads fenced code as one block per line, markup untouched", () => {
    expect(parseMarkdown("```ts\nconst a = **b**;\n\nx\n```")).toEqual([
      { kind: "code", text: "const a = **b**;" },
      { kind: "code", text: "" },
      { kind: "code", text: "x" },
    ]);
  });

  it("reads a table, with escaped pipes, line breaks and short rows", () => {
    expect(parseMarkdown("| Name | Note |\n|---|:--:|\n| a \\| b | *x*<br>y |\n| c |")).toEqual([
      {
        kind: "table",
        rows: [
          [[[{ text: "Name" }]], [[{ text: "Note" }]]],
          [[[{ text: "a | b" }]], [[{ text: "x", italic: true }], [{ text: "y" }]]],
          [[[{ text: "c" }]], [[]]],
        ],
      },
    ]);
  });

  it("reads a quote as a plain paragraph", () => {
    expect(parseMarkdown("> quoted\n> more")).toEqual([{ kind: "paragraph", inlines: [{ text: "quoted more" }] }]);
  });
});

describe("toMarkdown", () => {
  it("numbers ordered items and indents children to the parent's content column", () => {
    const blocks: Block[] = [
      { kind: "item", ordered: true, depth: 0, inlines: [{ text: "one" }] },
      { kind: "item", ordered: false, depth: 1, inlines: [{ text: "sub" }] },
      { kind: "item", ordered: true, depth: 0, inlines: [{ text: "two" }] },
    ];
    expect(md(blocks)).toBe("1. one\n   - sub\n2. two");
  });

  it("escapes text that would read as markup", () => {
    expect(md([{ kind: "paragraph", inlines: [{ text: "# not a heading, *not* emphasis, a_b" }] }])).toBe(
      "\\# not a heading, \\*not\\* emphasis, a\\_b",
    );
  });

  it("keeps spaces outside emphasis markers", () => {
    expect(md([{ kind: "paragraph", inlines: [{ text: "a" }, { text: " bold ", bold: true }, { text: "c" }] }])).toBe("a **bold** c");
  });

  it("round-trips every block kind through parseMarkdown", () => {
    const source = [
      "# Plan",
      "Intro with **bold**, *italic*, ~~gone~~, `code` and a [link](https://x.io/a).",
      "## Steps",
      "1. first\n   - detail\n     1. deeper\n2. second",
      "- bullet\n- another",
      "```\nline 1\nline 2\n```",
      "| Col | Other |\n| --- | --- |\n| a \\| b | x<br>y |",
    ].join("\n\n");
    expect(md(parseMarkdown(source))).toBe(source);
  });
});
