import { docLink, hiddenBetween, readDocument as modelOf } from "../../domain/fromDocs.js";
import { findSection, pathText, sectionsOf } from "../../domain/sections.js";
import { tabDocument } from "../../domain/tabs.js";
import { toMarkdown } from "../../domain/toMarkdown.js";
import { fileIdFrom } from "../../../editors/domain/ids.js";
import type { Deps } from "../ports.js";

export type SectionRow = { readonly id: string | null; readonly path: string; readonly level: number };

export type ReadResult = {
  readonly documentId: string;
  readonly title: string;
  /** Hand this to an edit as expected_revision to make it refuse if someone else wrote in between. */
  readonly revisionId: string;
  readonly link: string;
  /** The tab read, when one was named. */
  readonly tabId?: string;
  /** Every heading, whatever part was read: the map to pick a section from. */
  readonly sections: readonly SectionRow[];
  /** The section read, when one was asked for. */
  readonly section?: string;
  readonly markdown: string;
  readonly truncated: boolean;
  /** What the part read holds that markdown leaves out ("2 images, 1 footnote"), when it holds any. */
  readonly notShown?: string;
};

/**
 * A document as markdown, with the index of its sections.
 *
 * The index is always whole, even when one section is asked for or the text is
 * cut at max_chars: it is what an edit names a section by, and a partial map
 * would send the next call to the wrong heading.
 */
export const readDocument = async (
  deps: Deps,
  args: { readonly documentId: string; readonly section: string; readonly maxChars: number; readonly tab?: string },
): Promise<ReadResult> => {
  const id = fileIdFrom(args.documentId);
  const tab = args.tab?.trim() ? tabDocument(await deps.docs.get(id, { tabs: true }), args.tab) : undefined;
  const model = modelOf(tab ? tab.document : await deps.docs.get(id));
  const sections = sectionsOf(model.blocks);
  const chosen = args.section ? findSection(sections, args.section) : undefined;
  const markdown = toMarkdown(chosen ? model.blocks.slice(chosen.first, chosen.last) : model.blocks);
  const truncated = markdown.length > args.maxChars;
  const from = chosen ? (model.blocks[chosen.first]?.start ?? 0) : 0;
  const to = chosen ? (model.blocks[chosen.last]?.start ?? model.end) : model.end;
  const notShown = hiddenBetween(model, from, to);
  return {
    documentId: model.documentId,
    title: model.title,
    revisionId: model.revisionId,
    link: docLink(model.documentId),
    ...(tab ? { tabId: tab.tabId } : {}),
    sections: sections.map((s) => ({ id: s.id, path: pathText(s), level: s.level })),
    ...(chosen ? { section: pathText(chosen) } : {}),
    markdown: truncated ? markdown.slice(0, args.maxChars) : markdown,
    truncated,
    ...(notShown ? { notShown } : {}),
  };
};
