import type { Deps } from "../ports.js";

export type HistoryInput = {
  readonly startHistoryId: string;
  readonly maxResults: number;
  readonly pageToken?: string;
};

/**
 * What arrived since an anchor, instead of re-searching the same window.
 *
 * Gmail expires old history ids: a 404 from this call is not a fault, it means
 * the anchor is too old and a full search is needed to re-baseline.
 */
export const listHistory = async ({ gmail }: Deps, input: HistoryInput) => {
  const page = await gmail.listHistory(input);
  const messagesAdded = (page.history ?? []).flatMap((entry) =>
    (entry.messagesAdded ?? []).flatMap((added) => {
      const m = added.message;
      return m ? [{ id: m.id, threadId: m.threadId, labelIds: m.labelIds ?? [] }] : [];
    }),
  );
  return { messagesAdded, historyId: page.historyId, nextPageToken: page.nextPageToken };
};
