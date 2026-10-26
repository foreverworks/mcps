import { compact } from "@foreverworks/mcp-kit";

import { type ActionArgs, actionCallOf, confirmReason } from "../../domain/actions.js";
import { closest } from "../../domain/closest.js";
import { asAppError, fail } from "../../domain/errors.js";
import type { Action, ActionCall } from "../../domain/models.js";
import type { Deps } from "../ports.js";

const fieldView = (f: Action["fields"][number]) =>
  compact({
    field: f.key,
    name: f.name,
    description: f.description,
    required: f.required ? true : undefined,
    type: f.selector,
    options: f.options,
    example: f.example,
  });

const actionView = (a: Action) =>
  compact({
    action: `${a.domain}.${a.service}`,
    name: a.name,
    description: a.description,
    targets: a.targets ? true : undefined,
    response: a.response === "none" ? undefined : a.response,
    fields: a.fields.length === 0 ? undefined : a.fields.map(fieldView),
  });

/**
 * The actions Home Assistant offers. Without a domain, each domain and its
 * action names (the full list with fields runs to hundreds of kilobytes);
 * with one, each action with its fields. Domains whose actions the user
 * approves call by call say so.
 */
export const listActions = async (deps: Deps, a: { readonly domain?: string | undefined }) => {
  const confirm = new Set(deps.confirmDomains());
  const actions = await deps.ha.actions();
  const domains = [...new Set(actions.map((x) => x.domain))].sort();
  if (a.domain === undefined) {
    return {
      domains: domains.map((d) =>
        compact({
          domain: d,
          confirm: confirm.has(d) ? true : undefined,
          actions: actions.filter((x) => x.domain === d).map((x) => x.service).sort(),
        }),
      ),
      note: "call list_actions with a domain for each action's fields",
    };
  }
  const wanted = a.domain;
  const mine = actions.filter((x) => x.domain === wanted);
  if (mine.length === 0) {
    fail({ kind: "not_found", what: "domain", name: wanted, message: `Home Assistant has no actions in domain "${wanted}"`, suggestions: closest(wanted, domains) });
  }
  return compact({
    domain: wanted,
    confirm: confirm.has(wanted) ? "every action here goes through call_action_confirmed, which the user approves" : undefined,
    actions: [...mine].sort((x, y) => x.service.localeCompare(y.service)).map(actionView),
  });
};

/**
 * Home Assistant answers an action it does not have and one whose data does
 * not validate with the same bare 400, so after a 400 the list of actions
 * (a read) says which it was.
 */
const explainRefusal = async (deps: Deps, call: ActionCall, thrown: unknown): Promise<never> => {
  const known = asAppError(thrown);
  if (known?.kind !== "rejected" || known.status !== 400) throw thrown;
  const actions = await deps.ha.actions().catch(() => undefined);
  if (actions === undefined || actions.some((x) => x.domain === call.domain && x.service === call.service)) throw thrown;
  const name = `${call.domain}.${call.service}`;
  return fail({
    kind: "not_found",
    what: "action",
    name,
    message: `Home Assistant has no action ${name}; nothing ran`,
    suggestions: closest(name, actions.map((x) => `${x.domain}.${x.service}`)),
  });
};

/**
 * Run one action. `confirmed`: the call came through the tool a person
 * approves, so an action in a confirmed domain, or aimed at one, may run.
 * Sent once: a failure after sending is outcome_unknown, never a resend.
 */
export const callAction = async (deps: Deps, a: ActionArgs, confirmed: boolean) => {
  const call = actionCallOf(a);
  const name = `${call.domain}.${call.service}`;
  const reason = confirmReason(call, deps.confirmDomains());
  if (reason !== undefined && !confirmed) {
    fail({ kind: "needs_confirmation", action: name, reason, message: `${name} needs the user's approval: ${reason}; nothing was sent` });
  }
  const outcome = await deps.ha.call(call).catch((thrown: unknown) => explainRefusal(deps, call, thrown));
  return compact({
    action: name,
    changed: outcome.changed.map((s) => compact({ entity_id: s.entityId, state: s.state, last_changed: s.lastChanged })),
    response: outcome.response,
    note:
      outcome.changed.length === 0
        ? "no entity changed state while the action ran: it may already have been in that state, or the device reports later (get_states reads it now)"
        : undefined,
  });
};
