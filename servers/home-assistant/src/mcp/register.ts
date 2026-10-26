import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { callAction, listActions } from "../app/usecases/actions.js";
import { listAreas } from "../app/usecases/areas.js";
import { getStates, listEntities } from "../app/usecases/entities.js";
import { health } from "../app/usecases/health.js";
import { history, logbook } from "../app/usecases/history.js";
import { renderTemplate } from "../app/usecases/template.js";
import type { Deps } from "../app/ports.js";
import { DEFAULT_CONFIRM_DOMAINS } from "../domain/actions.js";
import { ENTITY_ID } from "../domain/entities.js";
import { DEFAULT_HOURS, MAX_DAYS } from "../domain/window.js";
import { handled } from "./envelope.js";

const NAME = /^[a-z0-9_]+$/;

const entityId = z.string().max(255).regex(ENTITY_ID, "an entity id, like light.kitchen");
const domainArg = z.string().max(64).regex(NAME, "a domain, like light");

const time = (what: string) =>
  z.iso
    .datetime({ offset: true })
    .optional()
    .describe(`${what}, with its offset: 2026-03-01T18:00:00+02:00 or 2026-03-01T16:00:00Z. health gives the instance's time zone.`);

const windowArgs = {
  start: time("Where the window starts; default the last `hours` before end"),
  end: time("Where it ends; default now"),
  hours: z.number().int().min(1).max(MAX_DAYS * 24).optional().describe(`Instead of start: this many hours before end (default ${DEFAULT_HOURS}).`),
};

const limitArg = (fallback: number, max: number, what: string) => z.number().int().min(1).max(max).default(fallback).describe(`At most this many ${what} (1-${max}).`);

const ids = (what: string) =>
  z
    .union([z.string().min(1).max(255), z.array(z.string().min(1).max(255)).min(1).max(100)])
    .optional()
    .describe(`One ${what} or a list of them.`);

const actionShape = {
  domain: domainArg.describe("The action's domain: light, switch, climate, lock, script, homeassistant, ..."),
  service: z.string().max(64).regex(NAME, "an action name, like turn_on").describe("The action within the domain: turn_on, set_temperature, unlock, ... (list_actions lists them)."),
  target: z
    .strictObject({
      entity_id: ids("entity id (or all, for every entity of the domain)"),
      device_id: ids("device id (list_areas)"),
      area_id: ids("area id (list_areas)"),
      floor_id: ids("floor id"),
      label_id: ids("label id"),
    })
    .optional()
    .describe("What the action acts on. Several kinds may be combined; an action that takes no target (homeassistant.reload_all, a script) leaves it out."),
  data: z
    .record(z.string(), z.unknown())
    .refine((d) => JSON.stringify(d).length <= 16_384, "at most 16 KB of data")
    .optional()
    .describe('The action\'s fields, as list_actions shows them: {"brightness_pct": 40}, {"temperature": 21.5}. Not the target.'),
  return_response: z.boolean().default(false).describe("Ask for the data the action answers with (a weather forecast, a calendar's events); only for actions list_actions marks with response."),
};

type ActionInput = {
  domain: string;
  service: string;
  target?: { entity_id?: string | string[] | undefined; device_id?: string | string[] | undefined; area_id?: string | string[] | undefined; floor_id?: string | string[] | undefined; label_id?: string | string[] | undefined } | undefined;
  data?: Record<string, unknown> | undefined;
  return_response: boolean;
};

/** The whole tool surface. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Whether this server works with its Home Assistant: the version, whether it is RUNNING, its time zone (history and logbook " +
        "times carry an offset), whether the WebSocket API signs in too, whose token it holds and whether that user is an " +
        "administrator (if not, the tools that need one are listed), and how many entities each domain has. ok: false comes with " +
        "the problem. Call it first, and whenever a call fails with unreachable or auth.",
      inputSchema: {},
    },
    handled(() => health(deps)),
  );

  server.registerTool(
    "list_entities",
    {
      title: "List entities",
      description:
        "Find entities: one row each with entity_id, name, state, unit and area, in entity id order. Filter by domain (light, sensor, " +
        "climate, ...), by area (its name or id), and by words that must all appear in the id, the name or the area. Use it to find the " +
        "entity_id other tools take; get_states reads an entity's attributes.",
      inputSchema: {
        domain: domainArg.optional().describe("Only entities of this domain, like light or sensor."),
        area: z.string().max(100).optional().describe("Only entities in this area, by its name or id (list_areas lists them)."),
        search: z.string().max(100).optional().describe("Words that must all appear in the entity id, its name or its area, ignoring case."),
        limit: limitArg(100, 1000, "rows"),
      },
    },
    handled((a: { domain?: string | undefined; area?: string | undefined; search?: string | undefined; limit: number }) => listEntities(deps, a)),
  );

  server.registerTool(
    "get_states",
    {
      title: "Get states",
      description:
        "The current state of one or more entities, with their attributes (a light's brightness, a thermostat's target, a sensor's " +
        "unit) and when the state last changed. An id Home Assistant does not know is listed under not_found; when none is known, the " +
        "call fails with suggestions.",
      inputSchema: {
        entity_ids: z.array(entityId).min(1).max(50).describe("The entity ids, like light.kitchen (list_entities finds them)."),
        attributes: z.boolean().default(true).describe("Include each entity's attributes."),
      },
    },
    handled((a: { entity_ids: string[]; attributes: boolean }) => getStates(deps, a)),
  );

  server.registerTool(
    "list_areas",
    {
      title: "List areas",
      description:
        "Every area (or one), with its floor, its devices and the entities in it: an entity's own area, else its device's, as Home " +
        "Assistant's area pages show them. Disabled devices and entities are left out. Also counts what has no area. Its ids are what " +
        "call_action takes as area_id and device_id.",
      inputSchema: {
        area: z.string().max(100).optional().describe("Only this area, by its name or id."),
        entities: z.boolean().default(true).describe("List each area's entity ids, not only how many there are."),
      },
    },
    handled((a: { area?: string | undefined; entities: boolean }) => listAreas(deps, a)),
  );

  server.registerTool(
    "history",
    {
      title: "State history",
      description:
        "How entities' states changed over a window, from the recorder: for each entity its changes oldest first (the first is the " +
        `state when the window opened), the newest limit of them. Default the last ${DEFAULT_HOURS} hours; at most ${MAX_DAYS} days, ` +
        "and only as far back as the recorder keeps (10 days unless configured otherwise).",
      inputSchema: {
        entity_ids: z.array(entityId).min(1).max(20).describe("The entities, like sensor.living_room_temperature."),
        ...windowArgs,
        attributes: z.boolean().default(false).describe("Include each change's attributes too (much larger)."),
        limit: limitArg(100, 1000, "changes per entity, the newest"),
      },
    },
    handled((a: { entity_ids: string[]; start?: string | undefined; end?: string | undefined; hours?: number | undefined; attributes: boolean; limit: number }) => history(deps, a)),
  );

  server.registerTool(
    "logbook",
    {
      title: "Logbook",
      description:
        "What happened over a window, as Home Assistant's logbook tells it: states that changed, automations and scripts that ran, " +
        "and what caused each (a user, an action, an automation) where it knows. Oldest first, the newest limit of them. Optionally for one entity.",
      inputSchema: {
        entity_id: entityId.optional().describe("Only this entity's entries."),
        ...windowArgs,
        limit: limitArg(100, 1000, "entries, the newest"),
      },
    },
    handled((a: { entity_id?: string | undefined; start?: string | undefined; end?: string | undefined; hours?: number | undefined; limit: number }) => logbook(deps, a)),
  );

  server.registerTool(
    "list_actions",
    {
      title: "List actions",
      description:
        "The actions (formerly services) Home Assistant offers. Without a domain, every domain with its action names; with one, each " +
        "action's description, whether it takes a target, whether it answers with data, and its fields (type, options, an example). " +
        `Domains whose actions the user approves call by call (${DEFAULT_CONFIRM_DOMAINS.join(", ")} unless configured otherwise) are marked confirm, ` +
        "and actions only an administrator's token may run are marked needs_admin when this token's user is not one.",
      inputSchema: { domain: domainArg.optional().describe("Only this domain's actions, with their fields.") },
    },
    handled((a: { domain?: string | undefined }) => listActions(deps, a)),
  );

  server.registerTool(
    "render_template",
    {
      title: "Render a template",
      description:
        "Render a Home Assistant template (Jinja) with its own states and helpers, for what no other tool answers in one call: " +
        "\"{{ states.light | selectattr('state', 'eq', 'on') | map(attribute='entity_id') | list }}\", " +
        "\"{{ area_entities('kitchen') }}\", \"{{ now() }}\". Rendering changes nothing. Home Assistant renders templates only for " +
        "administrators: with another user's token this answers needs_admin without asking Home Assistant (health says which it is).",
      inputSchema: {
        template: z.string().min(1).max(10_000).describe("The template text."),
        variables: z.record(z.string(), z.unknown()).optional().describe("Variables the template can use by name."),
      },
    },
    handled((a: { template: string; variables?: Record<string, unknown> | undefined }) => renderTemplate(deps, a)),
  );

  server.registerTool(
    "call_action",
    {
      title: "Run an action",
      description:
        "Run a Home Assistant action (formerly a service call): light.turn_on, climate.set_temperature, media_player.volume_set, " +
        "script.turn_on. Answers once it has run, with the states that changed. An action in a domain the user approves call by call " +
        `(${DEFAULT_CONFIRM_DOMAINS.join(", ")} unless configured otherwise), aimed at an entity of one, or a homeassistant action aimed ` +
        "wider than named entities, is refused here with needs_confirmation: use call_action_confirmed. An action Home Assistant runs " +
        "only for administrators (every reload, homeassistant.restart and the like) is refused with needs_admin, without being sent, " +
        "when this token's user is not one. Sent once: if the answer is " +
        "outcome_unknown, read the entities (get_states) before running it again. Only what the user asks for: these act on a home.",
      inputSchema: actionShape,
    },
    handled((a: ActionInput) => callAction(deps, a, false)),
  );

  server.registerTool(
    "call_action_confirmed",
    {
      title: "Run an action, with the user's approval",
      description:
        "The same as call_action, for any action, and the user approves every call before it runs: the way to lock or unlock a door, " +
        "arm or disarm an alarm, open or close a cover or a valve. Only when the user asked for that action.",
      inputSchema: actionShape,
    },
    handled((a: ActionInput) => callAction(deps, a, true)),
  );
};
