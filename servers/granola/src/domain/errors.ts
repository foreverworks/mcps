import { makeErrorKit } from "@foreverworks/mcp-kit";

/** The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts). */
export type AppError =
  /** The arguments cannot be answered as asked; nothing was sent. */
  | { readonly kind: "input"; readonly message: string }
  /** There is no grant, or Granola refused the one held (a refresh token that no longer works). */
  | { readonly kind: "not_authorized"; readonly message: string; readonly revoked?: true }
  /** A sign-in that did not complete: refused by the person, expired, or not the one begun. */
  | { readonly kind: "authorization"; readonly message: string }
  /** Granola's sign-in documents are not what this server expects. */
  | { readonly kind: "discovery"; readonly message: string }
  /** Granola or its sign-in service could not be reached. */
  | { readonly kind: "unreachable"; readonly message: string }
  /** Granola's MCP server answered with a failure of its own. */
  | { readonly kind: "upstream"; readonly message: string };

export const inputError = (message: string): AppError => ({ kind: "input", message });
/** `revoked`: Granola's sign-in service said the grant is over (invalid_grant, invalid_client), so it is dropped. */
export const notAuthorized = (message: string, revoked = false): AppError => ({ kind: "not_authorized", message, ...(revoked ? { revoked: true as const } : {}) });
export const authorizationError = (message: string): AppError => ({ kind: "authorization", message });

export const { fail, asAppError } = makeErrorKit<AppError>("granola");

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "input":
      return "fix what the message names and call again";
    case "not_authorized":
      return "call begin_authorization, open the link in a browser and sign in to Granola, then pass the address it lands on to complete_authorization";
    case "authorization":
      return "call begin_authorization again for a new link and finish the sign-in within ten minutes";
    case "discovery":
      return "check GRANOLA_MCP_URL and that Granola is reachable; if both are fine, Granola changed its sign-in and this server needs an update";
    case "unreachable":
      return "Granola did not answer; retry in a few minutes";
    case "upstream":
      return "Granola's server refused or failed the call; read the message. Granola limits requests per tool and plan, so wait a little if it is limiting you, and note that transcript tools need a paid Granola plan; call health if it keeps happening";
  }
};
