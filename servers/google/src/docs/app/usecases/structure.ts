import { fileIdFrom } from "../../../editors/domain/ids.js";
import { inputError, fail } from "../../domain/errors.js";
import { findText, literalMatcher, type Match } from "../../domain/find.js";
import { patternMatcher } from "../patterns.js";
import { docLink } from "../../domain/fromDocs.js";
import { outlineOf, type Part, pickTab, type TabRow, tabsOf } from "../../domain/structure.js";
import type { Deps } from "../ports.js";

export type GetArgs = {
  readonly documentId: string;
  readonly tab: string;
  readonly parts: readonly Part[];
  readonly startIndex?: number;
  readonly endIndex?: number;
  readonly suggestions: string;
  readonly format: "outline" | "raw";
  readonly fields: string;
  readonly maxChars: number;
};

/**
 * A document's structure with its indices (the outline), or the API's own
 * JSON (raw, narrowed by a field mask). Every tab is listed either way; the
 * outline shows one.
 */
export const getDocument = async (deps: Deps, args: GetArgs) => {
  const id = fileIdFrom(args.documentId);
  const suggestions = args.suggestions || undefined;
  if (args.format === "raw") {
    const raw = await deps.docs.get(id, { tabs: true, ...(suggestions ? { suggestions } : {}), ...(args.fields ? { fields: args.fields } : {}) });
    const size = JSON.stringify(raw).length;
    if (size > args.maxChars) {
      return fail(
        inputError(
          `the raw document is ${size} characters, over max_chars ${args.maxChars}: narrow it with fields (e.g. "revisionId,tabs(tabProperties,documentTab(namedRanges))"), ` +
            "raise max_chars, or read format outline",
        ),
      );
    }
    return { documentId: id, link: docLink(id), document: raw };
  }
  const doc = await deps.docs.get(id, { tabs: true, ...(suggestions ? { suggestions } : {}) });
  const tabs = tabsOf(doc);
  const chosen = pickTab(tabs, args.tab);
  return {
    documentId: doc.documentId ?? id,
    title: doc.title ?? "",
    revisionId: doc.revisionId ?? null,
    link: docLink(doc.documentId ?? id),
    tabs: tabs.map((t): TabRow => t.row),
    tabId: chosen.row.tabId,
    ...outlineOf(chosen.content, {
      parts: args.parts,
      maxChars: args.maxChars,
      ...(args.startIndex === undefined ? {} : { startIndex: args.startIndex }),
      ...(args.endIndex === undefined ? {} : { endIndex: args.endIndex }),
    }),
  };
};

export type FindArgs = {
  readonly documentId: string;
  readonly text: string;
  readonly tab: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  /** text is a JavaScript regular expression, run under a time limit. */
  readonly regex: boolean;
  readonly segments: "body" | "all";
  readonly limit: number;
};

export type FindResult = {
  readonly documentId: string;
  /** Hand it to batch_update_document with ranges from here: they are right for this revision. */
  readonly revisionId: string | null;
  readonly tabId: string;
  readonly matches: readonly Match[];
  readonly total: number;
  readonly truncated: boolean;
};

/** Every place a text (or a pattern) appears in one tab, as ranges a request can name. */
export const findInDocument = async (deps: Deps, args: FindArgs): Promise<FindResult> => {
  const id = fileIdFrom(args.documentId);
  const doc = await deps.docs.get(id, { tabs: true });
  const chosen = pickTab(tabsOf(doc), args.tab);
  if (args.regex && args.wholeWord) return fail(inputError("whole_word is for literal text; in a pattern, write \\b"));
  const matcher = args.regex ? patternMatcher(args.text, args.matchCase) : literalMatcher(args.text, { matchCase: args.matchCase, wholeWord: args.wholeWord });
  const found = findText(chosen.content, matcher, { segments: args.segments, limit: args.limit });
  return {
    documentId: doc.documentId ?? id,
    revisionId: doc.revisionId ?? null,
    tabId: chosen.row.tabId,
    matches: found.matches,
    total: found.total,
    truncated: found.total > found.matches.length,
  };
};
