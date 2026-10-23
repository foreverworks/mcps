import type { NotionPort } from "../../ports.js";

/**
 * A page object lists at most 25 pages of a relation and says so with
 * `has_more`. The rest come from the property item endpoint, 100 at a time;
 * this reads them all, so a relation read_page shows is never quietly short.
 * Capped, because a relation of thousands is a query, not a property to print.
 */
export const RELATION_READ_CAP = 1000;

export const allRelated = async (api: NotionPort, pageId: string, propertyId: string): Promise<{ readonly ids: readonly string[]; readonly capped: boolean }> => {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const items = await api.getPropertyItems(pageId, propertyId, cursor);
    for (const item of items.results) {
      if (item.type === "relation") ids.push(item.relation.id);
    }
    cursor = items.has_more ? (items.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined && ids.length < RELATION_READ_CAP);
  return { ids, capped: cursor !== undefined };
};
