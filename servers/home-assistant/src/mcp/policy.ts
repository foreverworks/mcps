import { summaryFrom, type ToolPolicy } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { actionCallOf, actionLine } from "../domain/actions.js";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts). Nothing here moves
 * money. Every read is a read; running an action is a write. An action in a
 * domain the deployment names (HOME_ASSISTANT_CONFIRM_DOMAINS: locks, alarms,
 * covers and valves by default), or aimed at one, goes only through
 * `call_action_confirmed`, which a person approves call by call, with the
 * line they read when the server asks itself (MCP_CONFIRM=elicit).
 */

const actionArgs = z
  .object({
    domain: z.string(),
    service: z.string(),
    target: z.record(z.string(), z.union([z.string(), z.array(z.string())]).optional()).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    return_response: z.boolean().optional(),
  })
  .loose();

/** The line comes from the same call the tool runs (actionCallOf), so the person approves what runs. */
const actionSummary = summaryFrom(actionArgs, (a) => actionLine(actionCallOf(a)));

export const POLICY: ToolPolicy = {
  health: { access: "read" },
  list_entities: { access: "read" },
  get_states: { access: "read" },
  list_areas: { access: "read" },
  history: { access: "read" },
  logbook: { access: "read" },
  list_actions: { access: "read" },
  render_template: { access: "read" },
  call_action: { access: "write" },
  call_action_confirmed: { access: "write", confirm: true, summary: actionSummary },
};
