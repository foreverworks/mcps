import { drift, fail } from "../domain/errors.js";
import type { Action, ActionOutcome, Device, EntityEntry, EntityHistory, EntityState, Field, InstanceConfig, LogbookEntry, Registries } from "../domain/models.js";
import type {
  WireArea,
  WireCallResult,
  WireConfig,
  WireDevice,
  WireEntityEntry,
  WireField,
  WireFloor,
  WireLogbookEntry,
  WireServiceDomain,
  WireState,
} from "../domain/schema.js";

/**
 * Home Assistant's wire shapes mapped inward. A field the API documents and
 * this server needs, gone missing, is drift: it fails loudly rather than
 * travelling on as an empty value. Pure.
 */

const missing = (what: string): never => fail(drift(`Home Assistant sent ${what}`));

export const listOf = <T>(value: unknown, what: string): readonly T[] => (Array.isArray(value) ? (value as readonly T[]) : missing(`${what} that is not a list`));

const text = (value: string | null | undefined): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

export const stateOf = (w: WireState): EntityState => {
  const entityId = w.entity_id ?? missing("a state without entity_id");
  const lastChanged = w.last_changed ?? missing(`the state of ${entityId} without last_changed`);
  return {
    entityId,
    state: w.state ?? missing(`the state of ${entityId} without its state`),
    attributes: w.attributes ?? {},
    lastChanged,
    lastUpdated: w.last_updated ?? lastChanged,
  };
};

export const configOf = (w: WireConfig): InstanceConfig => ({
  version: w.version ?? missing("its configuration without a version"),
  state: w.state ?? missing("its configuration without a state"),
  timeZone: w.time_zone ?? missing("its configuration without a time zone"),
  locationName: text(w.location_name),
  recoveryMode: w.recovery_mode === true,
  safeMode: w.safe_mode === true,
});

/** At most this many of a select's options: enough to choose from, not a page of them. */
const MAX_OPTIONS = 50;

const optionsOf = (selector: Readonly<Record<string, unknown>>): readonly string[] | undefined => {
  const select = selector["select"];
  if (typeof select !== "object" || select === null) return undefined;
  const options = (select as { options?: unknown }).options;
  if (!Array.isArray(options)) return undefined;
  const values = options.flatMap((o: unknown) =>
    typeof o === "string" ? [o] : typeof o === "object" && o !== null && typeof (o as { value?: unknown }).value === "string" ? [(o as { value: string }).value] : [],
  );
  return values.length === 0 ? undefined : values.slice(0, MAX_OPTIONS);
};

/** An action's fields, the fields of its sections (the UI's collapsed groups) beside the others. */
export const fieldsOf = (fields: Readonly<Record<string, WireField>> | undefined): readonly Field[] =>
  Object.entries(fields ?? {}).flatMap(([key, f]): readonly Field[] => {
    if (f.fields !== undefined) return fieldsOf(f.fields);
    const selector = f.selector ?? undefined;
    return [
      {
        key,
        name: text(f.name),
        description: text(f.description),
        required: f.required === true,
        example: f.example,
        selector: selector === undefined ? undefined : Object.keys(selector)[0],
        options: selector === undefined ? undefined : optionsOf(selector),
      },
    ];
  });

export const actionsOf = (domains: readonly WireServiceDomain[]): readonly Action[] =>
  domains.flatMap((d) => {
    const domain = d.domain ?? missing("an action domain without its name");
    return Object.entries(d.services ?? {}).map(([service, s]) => ({
      domain,
      service,
      name: text(s.name),
      description: text(s.description),
      fields: fieldsOf(s.fields),
      targets: s.target !== undefined && s.target !== null,
      response: s.response === undefined || s.response === null ? ("none" as const) : s.response.optional === false ? ("only" as const) : ("optional" as const),
    }));
  });

export const outcomeOf = (w: WireCallResult, returnResponse: boolean): ActionOutcome => {
  if (Array.isArray(w)) return { changed: (w as readonly WireState[]).map(stateOf) };
  if (typeof w !== "object" || w === null) return missing("an action's answer that is neither a list nor an object");
  const answer = w as Exclude<WireCallResult, readonly WireState[]>;
  const changed = listOf<WireState>(answer.changed_states ?? [], "changed_states").map(stateOf);
  return returnResponse ? { changed, response: answer.service_response } : { changed };
};

/**
 * One list per entity, oldest first. With minimal_response only the first
 * point carries the entity id and attributes; the rest are a state and a time.
 */
export const historyOf = (lists: readonly unknown[]): readonly EntityHistory[] =>
  lists.map((raw) => {
    const points = listOf<WireState>(raw, "an entity's history");
    const entityId = points[0]?.entity_id ?? missing("an entity's history without its entity_id");
    return {
      entityId,
      changes: points.map((p) => ({
        state: p.state ?? missing(`a point of ${entityId}'s history without its state`),
        at: p.last_changed ?? missing(`a point of ${entityId}'s history without last_changed`),
        attributes: p.attributes ?? undefined,
      })),
    };
  });

const whenOf = (when: string | number | undefined): string => {
  if (typeof when === "string") return when;
  if (typeof when === "number") return new Date(when * 1000).toISOString();
  return missing("a logbook entry without when");
};

export const logbookOf = (entries: readonly WireLogbookEntry[]): readonly LogbookEntry[] =>
  entries.map((e) => ({
    when: whenOf(e.when),
    entityId: text(e.entity_id),
    name: text(e.name),
    state: text(e.state),
    message: text(e.message),
    cause: {
      userId: text(e.context_user_id),
      action: e.context_domain !== undefined && e.context_service !== undefined ? `${e.context_domain}.${e.context_service}` : undefined,
      entityId: text(e.context_entity_id),
      name: text(e.context_entity_id_name) ?? text(e.context_name),
      event: text(e.context_event_type),
    },
  }));

const deviceOf = (w: WireDevice): Device => ({
  id: w.id ?? missing("a device without its id"),
  name: text(w.name_by_user) ?? text(w.name),
  areaId: text(w.area_id),
  disabled: w.disabled_by !== undefined && w.disabled_by !== null,
});

const entryOf = (w: WireEntityEntry): EntityEntry => ({
  entityId: w.entity_id ?? missing("a registry entry without its entity_id"),
  name: text(w.name) ?? text(w.original_name),
  deviceId: text(w.device_id),
  areaId: text(w.area_id),
  disabled: w.disabled_by !== undefined && w.disabled_by !== null,
});

export const registriesOf = (lists: {
  readonly areas: readonly WireArea[];
  readonly floors: readonly WireFloor[];
  readonly devices: readonly WireDevice[];
  readonly entities: readonly WireEntityEntry[];
}): Registries => ({
  areas: lists.areas.map((a) => {
    const id = a.area_id ?? missing("an area without its area_id");
    return { id, name: a.name ?? missing(`area ${id} without its name`), floorId: text(a.floor_id) };
  }),
  floors: lists.floors.map((f) => {
    const id = f.floor_id ?? missing("a floor without its floor_id");
    return { id, name: f.name ?? missing(`floor ${id} without its name`) };
  }),
  devices: lists.devices.map(deviceOf),
  entities: lists.entities.map(entryOf),
});
