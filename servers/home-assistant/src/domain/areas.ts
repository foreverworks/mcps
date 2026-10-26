import { compact } from "@foreverworks/mcp-kit";

import { areaIndex } from "./entities.js";
import type { Area, Registries } from "./models.js";

/**
 * The areas with their devices and entities, joined from the three
 * registries the way Home Assistant's own area pages join them: an entity is
 * in its own area, else in its device's. Disabled devices and entities are
 * left out, as they are there. Pure.
 */

const groupBy = <T>(items: readonly T[], key: (item: T) => string | undefined): ReadonlyMap<string, readonly T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
};

export const areasView = (registries: Registries, options: { readonly area?: Area | undefined; readonly entities: boolean }) => {
  const floors = new Map(registries.floors.map((f) => [f.id, f.name]));
  const areaOf = areaIndex(registries);
  const devices = registries.devices.filter((d) => !d.disabled);
  const entities = registries.entities.filter((e) => !e.disabled);
  const devicesByArea = groupBy(devices, (d) => d.areaId);
  const entitiesByArea = groupBy(entities, (e) => areaOf(e.entityId)?.id);
  const chosen = options.area === undefined ? [...registries.areas].sort((a, b) => a.name.localeCompare(b.name)) : [options.area];
  return compact({
    areas: chosen.map((a) => {
      const ids = (entitiesByArea.get(a.id) ?? []).map((e) => e.entityId).sort();
      return compact({
        area_id: a.id,
        name: a.name,
        floor: a.floorId === undefined ? undefined : floors.get(a.floorId),
        devices: (devicesByArea.get(a.id) ?? []).map((d) => compact({ device_id: d.id, name: d.name })),
        entity_count: ids.length,
        entities: options.entities ? ids : undefined,
      });
    }),
    unassigned:
      options.area === undefined
        ? { devices: devices.filter((d) => d.areaId === undefined).length, entities: entities.filter((e) => areaOf(e.entityId) === undefined).length }
        : undefined,
  });
};
