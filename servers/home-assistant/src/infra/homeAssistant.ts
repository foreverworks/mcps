import type { HomeAssistant } from "../app/ports.js";
import { actionBody } from "../domain/actions.js";
import { asAppError, fail } from "../domain/errors.js";
import type { WireArea, WireCallResult, WireConfig, WireDevice, WireEntityEntry, WireFloor, WireLogbookEntry, WireServiceDomain, WireState } from "../domain/schema.js";
import { actionsOf, configOf, historyOf, listOf, logbookOf, outcomeOf, registriesOf, stateOf } from "./mapping.js";
import type { Rest } from "./rest.js";
import { type Socket, type SocketResult, socketFailure } from "./socket.js";

/**
 * The port over Home Assistant's two APIs: REST for states, actions,
 * history, the logbook and templates, the WebSocket API for the registries,
 * which REST does not serve. The only module that knows their paths.
 */

/** An action may run a script that takes a while; Home Assistant answers once it has run. */
export const ACTION_TIMEOUT_MS = 90_000;
/** History and logbook queries read the recorder's database, which takes seconds on a large one. */
export const RECORDER_TIMEOUT_MS = 60_000;

const REGISTRY_COMMANDS = [
  { type: "config/area_registry/list" },
  { type: "config/floor_registry/list" },
  { type: "config/device_registry/list" },
  { type: "config/entity_registry/list" },
] as const;

const resultOf = (command: string, r: SocketResult | undefined, orElse?: (code: string) => unknown): unknown => {
  if (r === undefined) return fail({ kind: "drift", message: `no answer to ${command}` });
  if (r.ok) return r.result;
  if (orElse !== undefined) {
    const instead = orElse(r.code);
    if (instead !== undefined) return instead;
  }
  return fail(socketFailure(command, r));
};

export const makeHomeAssistant = (rest: Rest, socket: Socket): HomeAssistant => ({
  config: async () => configOf(await rest<WireConfig>("api/config")),

  states: async () => listOf<WireState>(await rest("api/states"), "states").map(stateOf),

  state: async (entityId) => {
    try {
      return stateOf(await rest<WireState>(`api/states/${encodeURIComponent(entityId)}`, { notFound: () => ({ kind: "not_found", what: "entity", name: entityId, message: `Home Assistant has no entity ${entityId}` }) }));
    } catch (thrown) {
      const known = asAppError(thrown);
      if (known?.kind === "not_found" && known.what === "entity") return undefined;
      throw thrown;
    }
  },

  actions: async () => actionsOf(listOf<WireServiceDomain>(await rest("api/services"), "actions")),

  call: async (call) =>
    outcomeOf(
      await rest<WireCallResult>(`api/services/${call.domain}/${call.service}`, {
        method: "POST",
        json: actionBody(call),
        ...(call.returnResponse ? { query: { return_response: true } } : {}),
        timeoutMs: ACTION_TIMEOUT_MS,
      }),
      call.returnResponse,
    ),

  history: async ({ entityIds, window, attributes }) =>
    historyOf(
      listOf<unknown>(
        await rest(`api/history/period/${encodeURIComponent(window.start)}`, {
          query: {
            filter_entity_id: entityIds.join(","),
            end_time: window.end,
            // Present means on: without attributes, the points between the first and the last are a state and a time.
            ...(attributes ? {} : { minimal_response: "", no_attributes: "" }),
          },
          timeoutMs: RECORDER_TIMEOUT_MS,
        }),
        "history",
      ),
    ),

  logbook: async ({ window, entityId }) =>
    logbookOf(
      listOf<WireLogbookEntry>(
        await rest(`api/logbook/${encodeURIComponent(window.start)}`, {
          query: { end_time: window.end, ...(entityId === undefined ? {} : { entity: entityId }) },
          timeoutMs: RECORDER_TIMEOUT_MS,
        }),
        "the logbook",
      ),
    ),

  // Rendering has no effect, so a template may be sent again after a failure like any read.
  renderTemplate: async (template, variables) =>
    rest<string>("api/template", { method: "POST", json: variables === undefined ? { template } : { template, variables }, as: "text", idempotent: true }),

  registries: async () => {
    const { results } = await socket.run(REGISTRY_COMMANDS);
    const [areas, floors, devices, entities] = REGISTRY_COMMANDS.map((c, i) =>
      // Floors arrived in Home Assistant 2024.4; an older one has none.
      resultOf(c.type, results[i], c.type === "config/floor_registry/list" ? (code) => (code === "unknown_command" ? [] : undefined) : undefined),
    );
    return registriesOf({
      areas: listOf<WireArea>(areas, "the area registry"),
      floors: listOf<WireFloor>(floors, "the floor registry"),
      devices: listOf<WireDevice>(devices, "the device registry"),
      entities: listOf<WireEntityEntry>(entities, "the entity registry"),
    });
  },

  socketCheck: async () => (await socket.run([])).version,
});
