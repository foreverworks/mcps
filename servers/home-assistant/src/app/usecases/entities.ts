import { compact, mapWithConcurrency } from "@foreverworks/mcp-kit";

import { closest } from "../../domain/closest.js";
import { areaIndex, areaNamed, redactAttributes, rowsMatching } from "../../domain/entities.js";
import { fail } from "../../domain/errors.js";
import type { Area, EntityState } from "../../domain/models.js";
import type { Deps } from "../ports.js";

export type ListArgs = {
  readonly domain?: string | undefined;
  readonly area?: string | undefined;
  readonly search?: string | undefined;
  readonly limit: number;
};

/** The entities a filter keeps, as compact rows: id, name, state, unit and area. */
export const listEntities = async (deps: Deps, a: ListArgs) => {
  // One after the other, not at once: an unproven token is never sent twice in parallel.
  const states = await deps.ha.states();
  const registries = await deps.ha.registries();
  let area: Area | undefined;
  if (a.area !== undefined) {
    area =
      areaNamed(registries.areas, a.area) ??
      fail({
        kind: "not_found",
        what: "area",
        name: a.area,
        message: `Home Assistant has no area "${a.area}"`,
        suggestions: closest(a.area, registries.areas.flatMap((x) => [x.name, x.id])),
      });
  }
  const rows = rowsMatching(states, areaIndex(registries), { domain: a.domain, area, search: a.search });
  const kept = rows.slice(0, a.limit);
  return compact({
    total: rows.length,
    returned: kept.length,
    truncated: rows.length > kept.length ? true : undefined,
    entities: kept,
    note: rows.length > kept.length ? `${rows.length - kept.length} more match: narrow the filter or raise limit` : rows.length === 0 ? "nothing matches; health counts the entities of each domain" : undefined,
  });
};

/** A state as get_states shows it, credentials removed. */
export const stateView = (s: EntityState, attributes: boolean) =>
  compact({
    entity_id: s.entityId,
    state: s.state,
    attributes: attributes ? redactAttributes(s.attributes) : undefined,
    last_changed: s.lastChanged,
    last_updated: s.lastUpdated,
  });

export type GetArgs = { readonly entity_ids: readonly string[]; readonly attributes: boolean };

/** The current state of each entity named; a name Home Assistant does not know is listed, or fails when none is known. */
export const getStates = async (deps: Deps, a: GetArgs) => {
  const ids = [...new Set(a.entity_ids)];
  const found = await mapWithConcurrency(ids, 6, async (id) => ({ id, state: await deps.ha.state(id) }));
  const missing = found.filter((f) => f.state === undefined).map((f) => f.id);
  if (missing.length === ids.length) {
    const known = (await deps.ha.states()).map((s) => s.entityId);
    const first = missing[0] ?? "";
    fail({
      kind: "not_found",
      what: "entity",
      name: missing.join(", "),
      message: `Home Assistant has no entity ${missing.join(", ")}`,
      suggestions: closest(first, known),
    });
  }
  return compact({
    states: found.flatMap((f) => (f.state === undefined ? [] : [stateView(f.state, a.attributes)])),
    not_found: missing.length === 0 ? undefined : missing,
  });
};
