/**
 * Home Assistant's wire shapes, as its REST and WebSocket APIs send them.
 * Every field is optional: what a mapper needs and does not find is drift
 * (infra/mapping.ts), never an empty value travelling on.
 *
 * Sources: the REST API (contributors.home-assistant.io/core/internals/rest-api)
 * and the WebSocket API's registry commands (config/*_registry/list), checked
 * against Home Assistant's own frontend, which reads the same commands.
 */

export type WireState = {
  readonly entity_id?: string;
  readonly state?: string;
  readonly attributes?: Readonly<Record<string, unknown>> | null;
  readonly last_changed?: string;
  readonly last_updated?: string;
};

/** GET /api/config; it holds more keys than these. */
export type WireConfig = {
  readonly version?: string;
  /** RUNNING, STARTING, STOPPING, NOT_RUNNING or FINAL_WRITE. */
  readonly state?: string;
  readonly time_zone?: string;
  readonly location_name?: string;
  readonly safe_mode?: boolean;
  readonly recovery_mode?: boolean;
};

/** One field of an action; a section holds fields of its own. */
export type WireField = {
  readonly name?: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly advanced?: boolean;
  readonly example?: unknown;
  readonly default?: unknown;
  readonly selector?: Readonly<Record<string, unknown>> | null;
  /** Present on a section (an "advanced options" group in the UI). */
  readonly fields?: Readonly<Record<string, WireField>>;
};

export type WireService = {
  readonly name?: string;
  readonly description?: string;
  readonly fields?: Readonly<Record<string, WireField>>;
  /** Present when the action takes a target (entities, devices, areas). */
  readonly target?: unknown;
  /** Present when the action can answer with data; `optional: false` when it only answers. */
  readonly response?: { readonly optional?: boolean } | null;
};

/** GET /api/services: one entry per domain. */
export type WireServiceDomain = {
  readonly domain?: string;
  readonly services?: Readonly<Record<string, WireService>>;
};

/** POST /api/services/<domain>/<service>: the changed states, or with ?return_response both. */
export type WireCallResult = readonly WireState[] | { readonly changed_states?: readonly WireState[]; readonly service_response?: unknown };

/**
 * GET /api/logbook/<start>. The REST API sends `when` as an ISO string; the
 * WebSocket API sends seconds, so both are read.
 */
export type WireLogbookEntry = {
  readonly when?: string | number;
  readonly name?: string;
  readonly message?: string;
  readonly entity_id?: string;
  readonly state?: string;
  readonly domain?: string;
  readonly context_user_id?: string;
  readonly context_event_type?: string;
  readonly context_domain?: string;
  readonly context_service?: string;
  readonly context_entity_id?: string;
  readonly context_entity_id_name?: string;
  readonly context_name?: string;
};

export type WireArea = { readonly area_id?: string; readonly name?: string; readonly floor_id?: string | null };

export type WireFloor = { readonly floor_id?: string; readonly name?: string };

export type WireDevice = {
  readonly id?: string;
  readonly name?: string | null;
  readonly name_by_user?: string | null;
  readonly area_id?: string | null;
  readonly manufacturer?: string | null;
  readonly model?: string | null;
  readonly disabled_by?: string | null;
};

export type WireEntityEntry = {
  readonly entity_id?: string;
  readonly name?: string | null;
  readonly original_name?: string | null;
  readonly device_id?: string | null;
  readonly area_id?: string | null;
  readonly disabled_by?: string | null;
  readonly hidden_by?: string | null;
};

/** A WebSocket message: the handshake's, or a command's result. */
export type WireSocketMessage = {
  readonly type?: string;
  readonly id?: number;
  readonly success?: boolean;
  readonly result?: unknown;
  readonly ha_version?: string;
  readonly message?: string;
  readonly error?: { readonly code?: string; readonly message?: string } | null;
};
