import { targetId } from "../../../drive/app/usecases/browse.js";
import { DOCUMENT_MIME, shape } from "../../../drive/domain/entries.js";
import { appendMarkdown, replaceSection, sectionBody } from "../../domain/edit.js";
import { finishCreated } from "../../../editors/app/created.js";
import { apiError, fail, inputError, STALE_REVISION } from "../../domain/errors.js";
import { docLink, type DocModel, hiddenBetween, readDocument } from "../../domain/fromDocs.js";
import { toMarkdown } from "../../domain/toMarkdown.js";
import { findSection, pathText, sectionsOf } from "../../domain/sections.js";
import type { DocsRequest } from "../../domain/schema.js";
import { fileIdFrom } from "../../../editors/domain/ids.js";
import { inTab, tabDocument } from "../../domain/tabs.js";
import type { Deps } from "../ports.js";

export type WriteResult = {
  readonly documentId: string;
  readonly link: string;
  /** The revision the edit produced, for the next edit's expected_revision. Null when Docs did not say. */
  readonly revisionId: string | null;
  readonly requests: number;
  readonly section?: string;
  readonly tabId?: string;
};

/**
 * The document as it is now, refused if the caller expected another revision.
 * The edit that follows is pinned to what this read saw either way, so the
 * check here only makes the refusal early and explicit.
 */
const current = async (deps: Deps, documentId: string, expected: string, tab = ""): Promise<DocModel & { readonly tabId: string }> => {
  const id = fileIdFrom(documentId);
  const read = tab.trim() ? tabDocument(await deps.docs.get(id, { tabs: true }), tab) : { document: await deps.docs.get(id), tabId: "" };
  const model = { ...readDocument(read.document), tabId: read.tabId };
  if (expected && expected !== model.revisionId) {
    return fail(
      apiError(409, `document ${documentId} is at revision ${model.revisionId}, not the expected ${expected}`, { reason: STALE_REVISION }),
    );
  }
  return model;
};

const apply = async (deps: Deps, model: DocModel & { readonly tabId?: string }, requests: readonly DocsRequest[]): Promise<string | null> =>
  requests.length === 0 ? model.revisionId : deps.docs.batchUpdate(model.documentId, inTab(requests, model.tabId ?? ""), model.revisionId);

export type EditArgs = {
  readonly documentId: string;
  readonly section: string;
  readonly markdown: string;
  /** Required: the revision the caller read, so an edit never lands on text it has not seen. */
  readonly expectedRevision: string;
  /** An empty body deletes everything under the heading; only with this. */
  readonly clear: boolean;
  /** Images, footnotes and the like in the section, which markdown cannot carry, are deleted with it; only with this. */
  readonly dropHidden: boolean;
  /** A tab other than the first, by id or title. */
  readonly tab?: string;
};

/**
 * Replace the body under one heading with markdown, in one batch.
 *
 * Refused before any write when the caller did not say which revision it read,
 * when the new body is empty and `clear` was not given, and when the section
 * holds what a read does not show (an image, a footnote, an equation) and
 * `dropHidden` was not given: each is a way to delete what nobody looked at.
 * The result says how much was there and how much replaced it.
 */
export const editSection = async (deps: Deps, args: EditArgs): Promise<WriteResult & { readonly title: string; readonly before: { readonly chars: number }; readonly after: { readonly chars: number }; readonly dropped?: string }> => {
  if (args.expectedRevision.trim() === "") return fail(inputError("give expected_revision: the revisionId read_document returned for the text this replaces"));
  const model = await current(deps, args.documentId, args.expectedRevision, args.tab);
  const section = findSection(sectionsOf(model.blocks), args.section);
  if (args.markdown.trim() === "" && !args.clear) {
    return fail(inputError(`an empty body deletes everything under "${pathText(section)}"; pass clear: true if that is meant`));
  }
  const body = sectionBody(model, section);
  const hidden = hiddenBetween(model, body.start, body.end);
  if (hidden && !args.dropHidden) {
    return fail(
      inputError(
        `"${pathText(section)}" holds ${hidden}, which read_document does not show and markdown cannot carry; replacing the section ` +
          "would delete them. Edit around them in Docs, or pass drop_hidden: true if they may go",
      ),
    );
  }
  const before = toMarkdown(model.blocks.slice(section.first + 1, section.last)).length;
  const requests = replaceSection(model, section, args.markdown);
  const revisionId = await apply(deps, model, requests);
  return {
    documentId: model.documentId,
    title: model.title,
    link: docLink(model.documentId),
    revisionId,
    requests: requests.length,
    section: pathText(section),
    ...(model.tabId ? { tabId: model.tabId } : {}),
    before: { chars: before },
    after: { chars: args.markdown.trim().length },
    ...(hidden ? { dropped: hidden } : {}),
  };
};

/** Markdown after the last paragraph, in one batch. */
export const appendToDocument = async (
  deps: Deps,
  args: { readonly documentId: string; readonly markdown: string; readonly expectedRevision: string; readonly tab?: string },
): Promise<WriteResult> => {
  const model = await current(deps, args.documentId, args.expectedRevision, args.tab);
  const requests = appendMarkdown(model, args.markdown);
  const revisionId = await apply(deps, model, requests);
  return { documentId: model.documentId, link: docLink(model.documentId), revisionId, requests: requests.length, ...(model.tabId ? { tabId: model.tabId } : {}) };
};

/**
 * A new document from markdown: made empty by Drive directly in its folder
 * (the Drive product's own create, so there is no moment in the wrong place and
 * no move), then filled in one batch.
 *
 * If the fill fails the document exists, empty, and the failure says so
 * (finishCreated).
 */
export const createDocument = async (
  deps: Deps,
  args: { readonly title: string; readonly markdown: string; readonly folderId: string; readonly folderPath: string },
): Promise<WriteResult & { readonly title: string }> => {
  const parentId = await targetId(deps.drive, args.folderId, args.folderPath);
  const made = shape(await deps.drive.drive.createFile(args.title, DOCUMENT_MIME, parentId));
  const link = made.link ?? docLink(made.id);
  return finishCreated({ id: made.id, link }, "document", async () => {
    const model = readDocument(await deps.docs.get(made.id));
    const requests = appendMarkdown(model, args.markdown);
    const revisionId = await apply(deps, model, requests);
    return { documentId: made.id, title: made.name, link, revisionId, requests: requests.length };
  });
};
