import type { Block } from "./blocks.js";
import { fail, inputError } from "./errors.js";
import type { DocModel } from "./fromDocs.js";
import { parseMarkdown } from "./edit/parseMarkdown.js";
import { pathText, type Section } from "./sections.js";
import type { DocsRequest } from "./schema.js";
import { deleteRange, insertBlocks, insertText } from "./edit/toRequests.js";

/**
 * The three writes, as request lists against one read of the document. Each
 * goes out in ONE batchUpdate pinned to the revision it was computed from
 * (app/usecases/write.ts), so the index arithmetic can never land on a
 * document that moved on in between.
 *
 * All three go through the same converter: parseMarkdown, then insertBlocks.
 */

/**
 * A heading inside the new body at or above the section's own level would end
 * the section early and silently re-parent whatever follows it. Refused, with
 * the level that would fit.
 */
const checkDepth = (section: Section, blocks: readonly Block[]): void => {
  const shallow = blocks.find((b) => b.kind === "heading" && b.level <= section.level);
  if (shallow && shallow.kind === "heading") {
    fail(
      inputError(
        `the new body has a level-${shallow.level} heading, which would end the section "${pathText(section)}" (level ${section.level}); ` +
          `use level ${section.level + 1} or deeper inside it`,
      ),
    );
  }
};

/**
 * Replace everything under one heading (its subsections included) with new
 * markdown, keeping the heading itself.
 *
 * The body runs from the end of the heading paragraph to the start of the next
 * heading at the same level or above. For the document's last section it runs
 * to the body's final newline, which Docs never lets anyone delete: that
 * newline stays and the new content takes it over ("intoEmpty"). When the
 * heading IS the last paragraph, a newline is added after it first, so there
 * is an empty paragraph to take over.
 */
/** The range a replacement deletes: from the end of the heading to the next section, or to the body's final newline. */
export const sectionBody = (model: DocModel, section: Section): { readonly start: number; readonly end: number } => {
  const heading = model.blocks[section.first];
  if (!heading) return fail(inputError(`section "${pathText(section)}" is not in this read of the document`));
  const next = model.blocks[section.last];
  return { start: heading.end, end: next ? next.start : Math.max(heading.end, model.end - 1) };
};

export const replaceSection = (model: DocModel, section: Section, markdown: string): readonly DocsRequest[] => {
  const blocks = parseMarkdown(markdown);
  checkDepth(section, blocks);
  const bodyStart = sectionBody(model, section).start;
  const next = model.blocks[section.last];

  if (next) {
    return [...(next.start > bodyStart ? [deleteRange(bodyStart, next.start)] : []), ...insertBlocks(blocks, bodyStart, "before")];
  }
  if (bodyStart >= model.end) {
    return blocks.length === 0 ? [] : [insertText(model.end - 1, "\n"), ...insertBlocks(blocks, model.end, "intoEmpty")];
  }
  const lastNewline = model.end - 1;
  return [...(lastNewline > bodyStart ? [deleteRange(bodyStart, lastNewline)] : []), ...insertBlocks(blocks, bodyStart, "intoEmpty")];
};

/**
 * Markdown after everything else. A document that already ends in an empty
 * paragraph (a new one always does) has it taken over; otherwise one is added
 * first, so the new content starts on a paragraph of its own.
 */
export const appendMarkdown = (model: DocModel, markdown: string): readonly DocsRequest[] => {
  const blocks = parseMarkdown(markdown);
  if (blocks.length === 0) return [];
  return model.tailEmpty
    ? insertBlocks(blocks, model.end - 1, "intoEmpty")
    : [insertText(model.end - 1, "\n"), ...insertBlocks(blocks, model.end, "intoEmpty")];
};
