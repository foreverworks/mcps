import { makeErrorKit } from "./errors.js";

/**
 * Why the guard did not run a tool. The vocabulary is the kit's, not a server's:
 * the guard is identical in every server, so is what it says, and every
 * server's envelope recognises these beside its own failures. The remedies name
 * no deployment: what is wrong with this one is in the message.
 */
export type GuardError =
  /** The tool's access class is above this server's ceiling (MCP_MAX_ACCESS), or this client's (MCP_CLIENT_MAX_ACCESS, `client` set). */
  | { readonly kind: "access_denied"; readonly access: string; readonly allowed: string; readonly client?: string; readonly message: string }
  /** The person at the client was asked to confirm and did not. */
  | { readonly kind: "confirmation_denied"; readonly message: string }
  /** Confirmation is required here, and this client or transport cannot ask for it. */
  | { readonly kind: "confirmation_unavailable"; readonly message: string }
  /** The call brought an answer that does not belong to it: expired, used before, another call's, or for other arguments. */
  | { readonly kind: "confirmation_invalid"; readonly message: string }
  /** The client cancelled the call (or went away) before it sent any write; the message says what was left undone. */
  | { readonly kind: "cancelled"; readonly message: string }
  /** The client cancelled the call after a write had been sent: it may have happened. */
  | { readonly kind: "outcome_unknown"; readonly message: string };

export const { fail: failGuard, asAppError: asGuardError } = makeErrorKit<GuardError>("mcp-kit.guard");

export const guardRemedy = (error: GuardError): string => {
  switch (error.kind) {
    case "access_denied":
      return error.client === undefined
        ? "this server does not run tools of that class; its operator sets MCP_MAX_ACCESS (docs/configuration.md)"
        : "this client may not run tools of that class on this server; its operator sets MCP_CLIENT_MAX_ACCESS (docs/configuration.md)";
    case "confirmation_denied":
      return "the user declined this call; do not retry it unless they ask";
    case "confirmation_unavailable":
      return "this server asks the user to confirm such calls, and this client cannot show the question; use a client with MCP elicitation, over stdio or over HTTP with protocol 2026-07-28";
    case "confirmation_invalid":
      return "make the call again without an answer; the user is asked afresh";
    case "cancelled":
      return "the call was cancelled before it finished; ask again if it is still wanted";
    case "outcome_unknown":
      return "the call was cancelled after a write was sent; look up whether it happened before sending it again";
  }
};
