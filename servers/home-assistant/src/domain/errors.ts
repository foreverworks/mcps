import { makeErrorKit } from "@foreverworks/mcp-kit";

/** The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts). */
export type AppError =
  /** The arguments cannot be done as asked; nothing was sent. */
  | { readonly kind: "input"; readonly message: string }
  /** A setting this needs is missing or wrong; `variable` names it. */
  | { readonly kind: "config"; readonly variable: string; readonly message: string }
  /**
   * Home Assistant refused the token (401) or this address (403). Never
   * retried: it counts every refusal as a failed login, and bans an address
   * after a few where IP banning is on. `sent` is false when this call sent
   * nothing because the same token was refused before.
   */
  | { readonly kind: "auth"; readonly status: 401 | 403; readonly sent: boolean; readonly message: string }
  /** The token works, but its user may not do this (an administrator's command over the WebSocket API). */
  | { readonly kind: "permission"; readonly message: string }
  /** No such entity, action, domain or area, or an endpoint whose integration is not loaded. */
  | {
      readonly kind: "not_found";
      readonly what: "entity" | "action" | "domain" | "area" | "endpoint";
      readonly name: string;
      readonly message: string;
      readonly suggestions?: readonly string[] | undefined;
    }
  /** The action is one a person approves call by call, and the tool called does not ask. Nothing was sent. */
  | { readonly kind: "needs_confirmation"; readonly action: string; readonly reason: string; readonly message: string }
  /** Home Assistant refused the request as asked (a bad field, a template that does not render); nothing ran. */
  | { readonly kind: "rejected"; readonly status: number; readonly message: string }
  /** Home Assistant did not answer: off, unreachable from here, or too slow. */
  | { readonly kind: "unreachable"; readonly message: string }
  /** Home Assistant answered a read with a server error: starting, stopping or failing. */
  | { readonly kind: "unavailable"; readonly status: number; readonly message: string }
  /** An action was sent and no clear answer came back: it may or may not have run. */
  | { readonly kind: "outcome_unknown"; readonly message: string }
  /** Something answered unlike Home Assistant's API. */
  | { readonly kind: "drift"; readonly message: string };

export const inputError = (message: string): AppError => ({ kind: "input", message });
export const drift = (message: string): AppError => ({ kind: "drift", message });

export const { fail, asAppError } = makeErrorKit<AppError>("home-assistant");

/** The variables the remedies name, kept here so a remedy and the code that reads them agree. */
export const URL_VARIABLE = "HOME_ASSISTANT_URL";
export const TOKEN_FILE_VARIABLE = "HOME_ASSISTANT_TOKEN_FILE";
export const TOKEN_VARIABLE = "HOME_ASSISTANT_TOKEN";
export const CONFIRM_VARIABLE = "HOME_ASSISTANT_CONFIRM_DOMAINS";

const WITHHELD = "this server sends nothing more with this token until the token file changes or the server restarts";

const notFoundRemedy = (what: Extract<AppError, { kind: "not_found" }>["what"]): string => {
  switch (what) {
    case "entity":
      return "list_entities finds an entity's id by name, area or domain";
    case "action":
      return "list_actions with the domain lists its actions and their fields";
    case "domain":
      return "list_actions without a domain lists every domain that has actions";
    case "area":
      return "list_areas lists every area by id and name";
    case "endpoint":
      return "the integration behind it is not loaded in Home Assistant: add it (default_config includes history, logbook and the recorder) and restart Home Assistant";
  }
};

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "input":
      return "fix what the message names and call again";
    case "config":
      return error.variable === "MCP_EGRESS_ALLOW"
        ? `add Home Assistant's host (from ${URL_VARIABLE}) to MCP_EGRESS_ALLOW, or correct ${URL_VARIABLE}`
        : `set ${error.variable} in this server's environment (see its README); the next call reads it again`;
    case "auth":
      return error.status === 401
        ? `make a new long-lived access token in an administrator's Home Assistant profile (Security tab) and put it in the file ${TOKEN_FILE_VARIABLE} names; Home Assistant counts every refused token as a failed login and may ban this address, so ${WITHHELD}`
        : `Home Assistant, or a proxy in front of it, refuses this address, usually because it banned it after failed logins: remove the address from ip_bans.yaml in Home Assistant's configuration folder, restart Home Assistant and check the token; ${WITHHELD}`;
    case "permission":
      return "use a long-lived access token made by an administrator: Home Assistant answers this only for administrators";
    case "not_found":
      return notFoundRemedy(error.what);
    case "needs_confirmation":
      return "call call_action_confirmed with the same arguments, which asks the user before the action runs, and only if the user asked for it";
    case "rejected":
      return "fix what Home Assistant's message names (list_actions shows an action's fields) and call again";
    case "unreachable":
      return `check that Home Assistant is running and that this machine reaches ${URL_VARIABLE} (a browser here opens it), then call health`;
    case "unavailable":
      return "Home Assistant is starting, stopping or failing: wait a minute and call health";
    case "outcome_unknown":
      return "the action may or may not have run: read the entities it targets (get_states) before running it again";
    case "drift":
      return `check that ${URL_VARIABLE} is Home Assistant's own address and not a proxy's sign-in page; if it is, note the version health reports and report it`;
  }
};
