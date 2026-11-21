import { makeErrorKit } from "@foreverworks/mcp-kit";

/** The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts). */
export type AppError =
  /** The arguments cannot be answered as asked; nothing was sent. */
  | { readonly kind: "input"; readonly message: string }
  /** There is no grant, or Mobbin refused the one held (a refresh token that no longer works). */
  | { readonly kind: "not_authorized"; readonly message: string; readonly revoked?: true }
  /** A sign-in that did not complete: refused by the person, expired, or not the one begun. */
  | { readonly kind: "authorization"; readonly message: string }
  /** Mobbin's sign-in documents are not what this server expects. */
  | { readonly kind: "discovery"; readonly message: string }
  /** Mobbin or its sign-in service could not be reached. */
  | { readonly kind: "unreachable"; readonly message: string }
  /** Mobbin's MCP server answered with a failure of its own. */
  | { readonly kind: "upstream"; readonly message: string };

export const inputError = (message: string): AppError => ({ kind: "input", message });
/** `revoked`: Mobbin's sign-in service said the grant is over (invalid_grant, invalid_client), so it is dropped. */
export const notAuthorized = (message: string, revoked = false): AppError => ({ kind: "not_authorized", message, ...(revoked ? { revoked: true as const } : {}) });
export const authorizationError = (message: string): AppError => ({ kind: "authorization", message });

export const { fail, asAppError } = makeErrorKit<AppError>("mobbin");

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "input":
      return "fix what the message names and call again";
    case "not_authorized":
      return "call begin_authorization, open the link in a browser signed in to Mobbin, then pass the address it lands on to complete_authorization";
    case "authorization":
      return "call begin_authorization again for a new link and finish the sign-in within ten minutes";
    case "discovery":
      return "check MOBBIN_MCP_URL and that Mobbin is reachable; if both are fine, Mobbin changed its sign-in and this server needs an update";
    case "unreachable":
      return "Mobbin did not answer; retry in a few minutes";
    case "upstream":
      return "Mobbin's server refused or failed the call; read the message, retry, and call health if it keeps happening";
  }
};
