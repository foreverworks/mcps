import { compact } from "@foreverworks/mcp-kit";

import { redactAttributes } from "../../domain/entities.js";
import { newest, type WindowArgs, windowOf } from "../../domain/window.js";
import type { Deps } from "../ports.js";

export type HistoryArgs = WindowArgs & { readonly entity_ids: readonly string[]; readonly attributes: boolean; readonly limit: number };

/**
 * Each entity's state changes in the window, oldest first, the newest `limit`
 * of them. The first is the state the entity was in when the window opened.
 */
export const history = async (deps: Deps, a: HistoryArgs) => {
  const window = windowOf(a, deps.now());
  const ids = [...new Set(a.entity_ids)];
  const recorded = new Map((await deps.ha.history({ entityIds: ids, window, attributes: a.attributes })).map((h) => [h.entityId, h]));
  return {
    start: window.start,
    end: window.end,
    entities: ids.map((id) => {
      const h = recorded.get(id);
      if (h === undefined) return { entity_id: id, count: 0, note: "Home Assistant recorded no state for it in this window: it is excluded from the recorder, or no such entity exists" };
      const { kept, omitted } = newest(h.changes, a.limit);
      return compact({
        entity_id: id,
        count: h.changes.length,
        earlier_omitted: omitted === 0 ? undefined : omitted,
        changes: kept.map((c) => compact({ state: c.state, at: c.at, attributes: c.attributes === undefined ? undefined : redactAttributes(c.attributes) })),
      });
    }),
  };
};

export type LogbookArgs = WindowArgs & { readonly entity_id?: string | undefined; readonly limit: number };

const nonEmpty = <T extends object>(value: T): T | undefined => (Object.keys(value).length === 0 ? undefined : value);

/** What happened in the window, as Home Assistant's logbook tells it, oldest first, the newest `limit` entries. */
export const logbook = async (deps: Deps, a: LogbookArgs) => {
  const window = windowOf(a, deps.now());
  const entries = await deps.ha.logbook({ window, entityId: a.entity_id });
  const { kept, omitted } = newest(entries, a.limit);
  return compact({
    start: window.start,
    end: window.end,
    count: entries.length,
    earlier_omitted: omitted === 0 ? undefined : omitted,
    entries: kept.map((e) =>
      compact({
        when: e.when,
        entity_id: e.entityId,
        name: e.name,
        state: e.state,
        message: e.message,
        by: nonEmpty(compact({ user_id: e.cause.userId, action: e.cause.action, entity_id: e.cause.entityId, name: e.cause.name, event: e.cause.event })),
      }),
    ),
  });
};
