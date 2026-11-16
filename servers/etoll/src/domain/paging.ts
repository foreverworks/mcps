/**
 * eToll's cursor paging (vehicles, tolls): each page may carry `nextCursor`,
 * and the server sends one even after the last full page, so a cursor alone
 * does not mean more follow. A list ends at a page without a cursor or at an
 * empty page, whichever comes first. A cap bounds a list that never ends
 * (the community client stops at 20 pages too). Pure.
 */

/** Pages read for one whole list before the answer says it was cut short. */
export const MAX_PAGES = 20;

/** The cursor to ask with next, or undefined when the list has ended. */
export const nextCursorOf = (items: readonly unknown[], cursor: string | null | undefined): string | undefined =>
  items.length > 0 && typeof cursor === "string" && cursor !== "" ? cursor : undefined;

export type CursorPage<T> = { readonly items: readonly T[]; readonly nextCursor: string | undefined };

/** Every page of a list, up to MAX_PAGES; `truncated` when more were promised than were read. */
export const collectAll = async <T>(fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>): Promise<{ readonly items: readonly T[]; readonly truncated: boolean }> => {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const next = await fetchPage(cursor);
    items.push(...next.items);
    if (next.nextCursor === undefined) return { items, truncated: false };
    cursor = next.nextCursor;
  }
  return { items, truncated: true };
};
