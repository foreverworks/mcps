import { compact } from "@foreverworks/mcp-kit";

import type { Area, Attributes, EntityState, Registries } from "./models.js";

/** An entity id: its domain, a dot, its object id, as Home Assistant writes them. */
export const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export const domainOf = (entityId: string): string => entityId.slice(0, Math.max(0, entityId.indexOf(".")));

/**
 * The credentials Home Assistant puts in states, removed before a state
 * reaches a model: a camera's `access_token` attribute, and the `token=` of
 * the proxy addresses in `entity_picture` (cameras, media players), which
 * open the picture to whoever holds them.
 */
const TOKEN_IN_URL = /([?&]token=)[^&#\s"]+/g;

export const redactAttributes = (attributes: Attributes): Attributes =>
  Object.fromEntries(
    Object.entries(attributes)
      .filter(([key]) => key !== "access_token")
      .map(([key, value]) => [key, typeof value === "string" ? value.replace(TOKEN_IN_URL, "$1[redacted]") : value]),
  );

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** The area an entity is in: its own, else its device's. */
export type AreaOf = (entityId: string) => Area | undefined;

export const areaIndex = (registries: Registries): AreaOf => {
  const areas = new Map(registries.areas.map((a) => [a.id, a]));
  const devices = new Map(registries.devices.map((d) => [d.id, d]));
  const entries = new Map(registries.entities.map((e) => [e.entityId, e]));
  return (entityId) => {
    const entry = entries.get(entityId);
    const areaId = entry?.areaId ?? (entry?.deviceId === undefined ? undefined : devices.get(entry.deviceId)?.areaId);
    return areaId === undefined ? undefined : areas.get(areaId);
  };
};

/** The area a person named, by its id or its name, ignoring case. */
export const areaNamed = (areas: readonly Area[], wanted: string): Area | undefined => {
  const w = wanted.trim().toLowerCase();
  return areas.find((a) => a.id === w) ?? areas.find((a) => a.name.toLowerCase() === w);
};

/** One entity as list_entities shows it. */
export const rowOf = (s: EntityState, areaOf: AreaOf) =>
  compact({
    entity_id: s.entityId,
    name: text(s.attributes["friendly_name"]),
    state: s.state,
    unit: text(s.attributes["unit_of_measurement"]),
    area: areaOf(s.entityId)?.name,
  });

export type Row = ReturnType<typeof rowOf>;

export type EntityFilter = {
  readonly domain?: string | undefined;
  readonly area?: Area | undefined;
  /** Words that must all appear in the entity id, its name or its area's name, ignoring case. */
  readonly search?: string | undefined;
};

/** The entities a filter keeps, as rows, in entity id order. */
export const rowsMatching = (states: readonly EntityState[], areaOf: AreaOf, filter: EntityFilter): readonly Row[] => {
  const words = (filter.search ?? "").toLowerCase().split(/\s+/).filter((w) => w !== "");
  return states
    .filter((s) => filter.domain === undefined || domainOf(s.entityId) === filter.domain)
    .filter((s) => filter.area === undefined || areaOf(s.entityId)?.id === filter.area.id)
    .map((s) => rowOf(s, areaOf))
    .filter((row) => {
      if (words.length === 0) return true;
      const haystack = [row.entity_id, row.name ?? "", row.area ?? ""].join(" ").toLowerCase();
      return words.every((w) => haystack.includes(w));
    })
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
};

/** How many entities each domain has, in domain order. */
export const countsPerDomain = (states: readonly EntityState[]): Readonly<Record<string, number>> => {
  const counts = new Map<string, number>();
  for (const s of states) counts.set(domainOf(s.entityId), (counts.get(domainOf(s.entityId)) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
};
