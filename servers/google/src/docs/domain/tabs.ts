import { type ApiRequest, rewriteTyped } from "../../editors/domain/discovery.js";
import { DOCS_API } from "./api.js";
import type { DocsRequest, RawDocument } from "./schema.js";
import { pickTab, tabsOf } from "./structure.js";

/**
 * The markdown tools on a tab other than the first. Docs returns a tab's body
 * only with includeTabsContent, under `tabs`, and a request reaches it only
 * when each of its locations and ranges names the tab. Pure.
 */

/** One tab as the document the markdown model reads: its body and lists, the document's id, title and revision. */
export const tabDocument = (doc: RawDocument, selector: string): { readonly document: RawDocument; readonly tabId: string } => {
  const tab = pickTab(tabsOf(doc), selector);
  return {
    tabId: tab.row.tabId,
    document: {
      ...(doc.documentId ? { documentId: doc.documentId } : {}),
      ...(doc.title ? { title: doc.title } : {}),
      ...(doc.revisionId ? { revisionId: doc.revisionId } : {}),
      ...(tab.content.body ? { body: tab.content.body } : {}),
      ...(tab.content.lists ? { lists: tab.content.lists } : {}),
    },
  };
};

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The requests with every Location and Range naming the tab; unchanged for the first tab read the old way (no id). */
export const inTab = (requests: readonly DocsRequest[], tabId: string): readonly DocsRequest[] =>
  tabId === ""
    ? requests
    : (rewriteTyped(DOCS_API, requests as readonly ApiRequest[], (type, value) =>
        (type === "Location" || type === "Range") && isObject(value) ? { ...value, tabId } : undefined,
      ) as readonly DocsRequest[]);
