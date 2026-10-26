import type { Action, ActionCall, ActionOutcome, EntityHistory, EntityState, InstanceConfig, LogbookEntry, Registries } from "../domain/models.js";
import type { Window } from "../domain/window.js";

/**
 * One Home Assistant instance, over its REST and WebSocket APIs. Every
 * operation reads the address and the token again, and fails with a tagged
 * error: config, auth (never retried), not_found, rejected, unreachable,
 * unavailable, outcome_unknown or drift.
 */
export type HomeAssistant = {
  readonly config: () => Promise<InstanceConfig>;
  readonly states: () => Promise<readonly EntityState[]>;
  /** Undefined when Home Assistant has no such entity. */
  readonly state: (entityId: string) => Promise<EntityState | undefined>;
  readonly actions: () => Promise<readonly Action[]>;
  /** Run an action once. Never sent again on a failure: it may have run. */
  readonly call: (call: ActionCall) => Promise<ActionOutcome>;
  readonly history: (query: { readonly entityIds: readonly string[]; readonly window: Window; readonly attributes: boolean }) => Promise<readonly EntityHistory[]>;
  readonly logbook: (query: { readonly window: Window; readonly entityId?: string | undefined }) => Promise<readonly LogbookEntry[]>;
  readonly renderTemplate: (template: string, variables: Readonly<Record<string, unknown>> | undefined) => Promise<string>;
  /** The area, floor, device and entity registries, in one WebSocket session. */
  readonly registries: () => Promise<Registries>;
  /** Open a WebSocket session and sign in: the version it reports. */
  readonly socketCheck: () => Promise<string>;
};

/** Where this server reaches Home Assistant, for health to say. */
export type Instance = { readonly url: string };

export type Deps = {
  readonly ha: HomeAssistant;
  /** HOME_ASSISTANT_URL, read again on every call; a config failure when it is missing or unusable. */
  readonly instance: () => Instance;
  /** HOME_ASSISTANT_CONFIRM_DOMAINS, read again on every call; a config failure when it is unusable. */
  readonly confirmDomains: () => readonly string[];
  readonly now: () => number;
};
