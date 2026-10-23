import { makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit,
 * errors.ts): no classes, no `instanceof`, so a failure survives
 * serialisation and a module boundary.
 *
 * Signing in is this server's own job: it reads the password from its
 * credential source, submits it, and reads the code SPV e-mails from the mail
 * source. So `needs_login` is rare and always says which step a person or an
 * agent has to finish; `session_expired` never reaches a client, because every
 * read that meets it signs in again once and retries.
 */
export type AppError =
  /** Something this deployment must set: a variable, a file, an upstream tool. Nothing was sent to SPV. */
  | { readonly kind: "config"; readonly message: string }
  /**
   * A sign-in that this server cannot finish by itself:
   * - `awaiting_code`: SPV e-mailed a code and no mail source is configured (or it is `manual`);
   * - `code_not_received`: the mail source did not show a new code in time;
   * - `pending_expired`: complete_login came after SPV's five minutes.
   */
  | { readonly kind: "needs_login"; readonly reason: "awaiting_code" | "code_not_received" | "pending_expired"; readonly message: string; readonly expires_at?: string }
  /** SPV refused the user name and password, or the code. `message` is SPV's own words where it gave any. */
  | { readonly kind: "login_refused"; readonly step: "password" | "code"; readonly message: string }
  /** Internal: the stored session is gone at SPV. Every caller signs in again once; never shown to a client. */
  | { readonly kind: "session_expired"; readonly message: string }
  /** The mail or vault MCP server failed: unreachable, refused the token, or its tool answered an error. */
  | { readonly kind: "upstream"; readonly source: "mail" | "vault"; readonly message: string }
  /** No message with that key, no reply to that request yet, no such document type. */
  | { readonly kind: "not_found"; readonly message: string }
  /** The arguments cannot become a request; nothing was sent. */
  | { readonly kind: "input"; readonly message: string }
  /** SPV refused a document request, in its own words. */
  | { readonly kind: "refused"; readonly message: string }
  /** SPV was unreachable or answered with a server error (status 0 is no connection). */
  | { readonly kind: "api"; readonly status: number; readonly message: string }
  /** SPV answered, but not with the page this server was written against. */
  | { readonly kind: "drift"; readonly message: string }
  /** SPV served a file whose name says it is another message's document; nothing was saved. */
  | { readonly kind: "wrong_document"; readonly key: string; readonly message: string }
  /** What was asked needs something this server does not have (a declaration ANAF takes only signed with a qualified certificate); nothing was sent. */
  | { readonly kind: "unsupported"; readonly message: string };

export type Kind = AppError["kind"];

export const configError = (message: string): AppError => ({ kind: "config", message });
export const inputError = (message: string): AppError => ({ kind: "input", message });
export const notFound = (message: string): AppError => ({ kind: "not_found", message });
export const drift = (message: string): AppError => ({ kind: "drift", message });
export const sessionExpired = (message: string): AppError => ({ kind: "session_expired", message });
export const upstreamError = (source: "mail" | "vault", message: string): AppError => ({ kind: "upstream", source, message });

export const { fail, asAppError } = makeErrorKit<AppError>("anaf-spv");

/**
 * What to do about it, in one sentence an operator or an agent can act on. It
 * names this server's tools and variables, never a deployment's commands.
 */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return "set what the message names (the README's Configuration section lists every variable), then call the tool again; nothing was sent to SPV";
    case "needs_login":
      switch (error.reason) {
        case "awaiting_code":
        case "code_not_received":
          return (
            "SPV e-mailed a security code (sender Autentificare.SpatiuPrivat@anaf.ro, subject \"Cod de siguranta\"); read the newest one from that mailbox " +
            `and pass its digits to complete_login${error.expires_at ? ` before ${error.expires_at}` : " within five minutes"}`
          );
        case "pending_expired":
          return "call login again: it requests a new code, which complete_login must receive within five minutes";
      }
      return "call login";
    case "login_refused":
      return error.step === "password"
        ? "SPV refused the user name or password: check the credential source (health shows which), fix it, then call login; repeated failures can lock the account"
        : "SPV refused the code: call login again for a new one, and pass only the newest code";
    case "session_expired":
      return "call login, then call the tool again";
    case "upstream":
      return error.source === "mail"
        ? "the mail MCP server failed; check it answers (its own health tool), or read the code yourself and pass it to complete_login"
        : "the vault MCP server failed; check it answers and holds the item ANAF_SPV_VAULT_ITEM names";
    case "not_found":
      return "list_messages gives every message's key; a reply to a request appears a minute or two after request_document";
    case "input":
      return "fix what the message names and call again; nothing was sent to SPV";
    case "refused":
      return "SPV refused the request in its own words; list_document_types says which fields each type takes";
    case "api":
      return error.status === 0 ? "SPV was unreachable; retry in a few minutes" : "SPV failed; retry later, it is often down for maintenance at night and on weekends";
    case "drift":
      return "SPV's pages changed under this server; it needs updating, report the message";
    case "wrong_document":
      return "nothing was saved; call download_message with the same key again, and if SPV serves the same file, report the message";
    case "unsupported":
      return "nothing was sent; the message says what it needs and where the document can go instead";
  }
};
