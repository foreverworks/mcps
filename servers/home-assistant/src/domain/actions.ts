import { domainOf, ENTITY_ID } from "./entities.js";
import { fail, inputError } from "./errors.js";
import type { ActionCall, Target } from "./models.js";

/**
 * Running an action (what Home Assistant called a service until 2024.8):
 * the call as the tools take it, which calls a person approves first, the
 * body the REST API takes, and the line that person reads. Pure.
 */

/** Unset: these. Physical security and openings: a door unlocked, an alarm off, a garage opened, water let in. */
export const DEFAULT_CONFIRM_DOMAINS: readonly string[] = ["lock", "alarm_control_panel", "cover", "valve"];

const NAME = /^[a-z0-9_]+$/;

/**
 * HOME_ASSISTANT_CONFIRM_DOMAINS: domains separated by commas; unset or empty
 * means the default, `none` means no domain. Anything else that is not a
 * list of domains is a problem, so a typo never turns confirmation off.
 */
export const confirmDomainsFrom = (raw: string | undefined): { readonly domains: readonly string[] } | { readonly problem: string } => {
  const text = (raw ?? "").trim();
  if (text === "") return { domains: DEFAULT_CONFIRM_DOMAINS };
  if (text.toLowerCase() === "none") return { domains: [] };
  const domains = text.split(",").map((d) => d.trim()).filter((d) => d !== "");
  const bad = domains.filter((d) => !NAME.test(d));
  return bad.length === 0 ? { domains: [...new Set(domains)] } : { problem: `not domain names: ${bad.join(", ")} (lowercase letters, digits and _, separated by commas; or none)` };
};

/**
 * Domains whose actions reach entities of other domains: homeassistant.turn_off
 * closes a cover and homeassistant.toggle opens one, so such an action aimed
 * wider than named entities may reach a domain the person approves.
 */
const CROSS_DOMAIN: ReadonlySet<string> = new Set(["homeassistant"]);

/** Why this call needs the person's approval first, or undefined when it does not. */
export const confirmReason = (call: ActionCall, confirmDomains: readonly string[]): string | undefined => {
  const confirm = new Set(confirmDomains);
  if (confirm.size === 0) return undefined;
  if (confirm.has(call.domain)) return `${call.domain} actions are approved by the user call by call`;
  const named = call.target.entityId.filter((id) => confirm.has(domainOf(id)));
  if (named.length > 0) return `it targets ${named.join(", ")}, in a domain the user approves call by call`;
  const wide = call.target.entityId.includes("all") || call.target.deviceId.length + call.target.areaId.length + call.target.floorId.length + call.target.labelId.length > 0;
  if (CROSS_DOMAIN.has(call.domain) && wide) {
    return `a ${call.domain} action aimed at devices, areas, floors, labels or all entities can reach ${[...confirm].join(", ")}, which the user approves call by call`;
  }
  return undefined;
};

/** The target's fields, as Home Assistant names them in an action's data. */
const TARGET_FIELDS: readonly (readonly [keyof Target, string])[] = [
  ["entityId", "entity_id"],
  ["deviceId", "device_id"],
  ["areaId", "area_id"],
  ["floorId", "floor_id"],
  ["labelId", "label_id"],
];

const ID = /^[A-Za-z0-9_-]{1,255}$/;

export type ActionArgs = {
  readonly domain: string;
  readonly service: string;
  readonly target?: Readonly<Partial<Record<string, string | readonly string[] | undefined>>> | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
  readonly return_response?: boolean | undefined;
};

const listOf = (value: string | readonly string[] | undefined): readonly string[] => (value === undefined ? [] : typeof value === "string" ? [value] : value);

/** The call the arguments describe, or an input failure naming what is wrong. */
export const actionCallOf = (a: ActionArgs): ActionCall => {
  if (!NAME.test(a.domain)) fail(inputError(`domain "${a.domain}" is not a Home Assistant domain (lowercase letters, digits and _)`));
  if (!NAME.test(a.service)) fail(inputError(`service "${a.service}" is not an action name (lowercase letters, digits and _)`));
  const data = a.data ?? {};
  const misplaced = TARGET_FIELDS.map(([, field]) => field).filter((field) => Object.hasOwn(data, field));
  if (misplaced.length > 0) fail(inputError(`put ${misplaced.join(", ")} in target, not in data, so the call's target is checked`));
  const target = Object.fromEntries(TARGET_FIELDS.map(([key, field]) => [key, [...new Set(listOf(a.target?.[field]))]])) as unknown as Target;
  const badEntities = target.entityId.filter((id) => id !== "all" && !ENTITY_ID.test(id));
  if (badEntities.length > 0) fail(inputError(`not entity ids: ${badEntities.join(", ")} (like light.kitchen, or all)`));
  const badIds = [...target.deviceId, ...target.areaId, ...target.floorId, ...target.labelId].filter((id) => !ID.test(id));
  if (badIds.length > 0) fail(inputError(`not device, area, floor or label ids: ${badIds.join(", ")}`));
  return { domain: a.domain, service: a.service, target, data, returnResponse: a.return_response === true };
};

/** The JSON body the REST API takes: the data, with the target's fields beside it. */
export const actionBody = (call: ActionCall): Readonly<Record<string, unknown>> => ({
  ...call.data,
  ...Object.fromEntries(TARGET_FIELDS.filter(([key]) => call.target[key].length > 0).map(([key, field]) => [field, call.target[key]])),
});

const SECRET_KEY = /code|pass|pin|secret|token/i;

const valueText = (key: string, value: unknown): string => {
  if (SECRET_KEY.test(key)) return "****";
  const shown = JSON.stringify(value) ?? "null";
  return shown.length > 60 ? `${shown.slice(0, 57)}...` : shown;
};

const targetText = (target: Target): string => {
  const parts = [
    target.entityId.length > 0 ? target.entityId.join(", ") : "",
    target.deviceId.length > 0 ? `device ${target.deviceId.join(", ")}` : "",
    target.areaId.length > 0 ? `area ${target.areaId.join(", ")}` : "",
    target.floorId.length > 0 ? `floor ${target.floorId.join(", ")}` : "",
    target.labelId.length > 0 ? `label ${target.labelId.join(", ")}` : "",
  ].filter((p) => p !== "");
  return parts.length === 0 ? "no target" : parts.join("; ");
};

const MAX_LINE = 300;

/**
 * The ONE line a person approves (MCP_CONFIRM=elicit), from the same call the
 * tool runs: the action, its target, and its data, with a code or password
 * shown as ****. Too long for the line, the data shows its field names only.
 */
export const actionLine = (call: ActionCall): string => {
  const head = `run the Home Assistant action ${call.domain}.${call.service} on ${targetText(call.target)}`;
  const entries = Object.entries(call.data);
  const full = entries.length === 0 ? head : `${head}, with ${entries.map(([k, v]) => `${k}=${valueText(k, v)}`).join(", ")}`;
  if (full.length <= MAX_LINE) return full;
  const keys = `${head}, with fields ${entries.map(([k]) => k).join(", ")}`;
  return keys.length <= MAX_LINE ? keys : `${keys.slice(0, MAX_LINE - 3)}...`;
};
