import { makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit,
 * errors.ts): no classes, no `instanceof`, so a failure survives
 * serialisation and a module boundary.
 *
 * Two of them are about signing in. `needs_login` is a session that is gone
 * and no password to make a new one: the remedy is the user's browser.
 * `login_refused` is a password Keycloak said no to: sending it again
 * unchanged only brings the account closer to Keycloak's lockout, so its
 * remedy says to fix it first.
 */
export type AppError =
  /** A setting is missing or cannot be used (a password file, the vault's settings, a corrupt session file). Nothing was sent. */
  | { readonly kind: "config"; readonly message: string }
  /**
   * No session and no password to make one: never connected, the refresh token expired
   * or was revoked, or eToll answered 401 to a fresh token. `reason` says which.
   */
  | { readonly kind: "needs_login"; readonly reason: "never_connected" | "expired" | "revoked" | "refused"; readonly message: string }
  /** Keycloak refused the configured user name and password (or will not take a password at all). */
  | { readonly kind: "login_refused"; readonly message: string }
  /** No such vehicle, vignette, invoice or order. `status` is eToll's, when it said so. */
  | { readonly kind: "not_found"; readonly message: string; readonly status?: number | undefined }
  /** The arguments cannot become a request. `status` is eToll's when it was eToll that said so (400, 422). */
  | { readonly kind: "input"; readonly message: string; readonly status?: number | undefined }
  /**
   * eToll said no, with its own code: a vehicle not eligible, a vignette that would overlap one
   * already bought, an unpaid order already open for the same product (`pendingOrderId`), or a
   * price that changed since the quote (PRICE_CHANGED, this server's own, with no `status`).
   */
  | { readonly kind: "refused"; readonly code: string; readonly message: string; readonly pendingOrderId?: string | undefined; readonly status?: number | undefined }
  /** Still 429 after the retries. */
  | { readonly kind: "rate_limited"; readonly message: string }
  /** A request that creates something failed after eToll may have acted on it. Never resent. */
  | { readonly kind: "outcome_unknown"; readonly message: string }
  /** eToll or Keycloak was unreachable or unwell (status 0 is no connection). */
  | { readonly kind: "api"; readonly status: number; readonly message: string }
  /** eToll answered, but not in the shape this server was written against. */
  | { readonly kind: "drift"; readonly message: string }
  /** The vault MCP server the password is read from failed. */
  | { readonly kind: "upstream"; readonly source: "vault"; readonly message: string };

export type Kind = AppError["kind"];

/** The HTTP status eToll answered with, for a failure that came from an answer. */
export const statusOf = (error: AppError | undefined): number | undefined => (error !== undefined && "status" in error ? error.status : undefined);

export const configError = (message: string): AppError => ({ kind: "config", message });
export const inputError = (message: string): AppError => ({ kind: "input", message });
export const notFound = (message: string): AppError => ({ kind: "not_found", message });
export const drift = (message: string): AppError => ({ kind: "drift", message });
export const refused = (code: string, message: string, pendingOrderId?: string): AppError => ({ kind: "refused", code, message, ...(pendingOrderId ? { pendingOrderId } : {}) });
export const needsLogin = (reason: Extract<AppError, { kind: "needs_login" }>["reason"], message: string): AppError => ({ kind: "needs_login", reason, message });
export const upstreamError = (source: "vault", message: string): AppError => ({ kind: "upstream", source, message });

export const { fail, asAppError } = makeErrorKit<AppError>("etoll");

/** The code this server gives a price that moved between the quote, the confirmation and the order. */
export const PRICE_CHANGED = "PRICE_CHANGED";

/** The code this server gives an order eToll would not delete, which may be paid. */
export const ORDER_NOT_DELETABLE = "ORDER_NOT_DELETABLE";

/**
 * A step after eToll made an order failed, and the order could not be
 * cancelled either: it is open and unpaid. The failure names it, because eToll
 * lists an unpaid order nowhere and refuses another for the same vignette
 * while it is open.
 */
export const orderLeftOpen = (what: string, orderId: string): AppError => ({
  kind: "outcome_unknown",
  message:
    `${what}; eToll made order ${orderId}, which could not be cancelled: it is open and unpaid, and nothing is charged unless its payment page is paid. ` +
    `cancel_order with order_id ${orderId} drops it; unpaid, it also expires by itself`,
});

/** What to do about a refusal, by eToll's code; the codes come from the portal's own messages. */
const refusedRemedy = (error: Extract<AppError, { kind: "refused" }>): string => {
  switch (error.code) {
    case "PENDING_ORDER_SAME_PRODUCT":
      return `an unpaid order for this vignette is already open${error.pendingOrderId ? ` (order ${error.pendingOrderId})` : ""}: if place_order handed over its payment page, the user can still pay there; otherwise cancel_order it and order again`;
    case ORDER_NOT_DELETABLE:
      return "nothing was changed: get_order (for an order this server placed) or list_tolls shows whether it was paid; an unpaid order expires by itself, and nothing is charged unless its payment page is paid";
    case "VIGNETTE_OVERLAP":
      return "the vehicle already has a vignette for part of that period: quote again with a start date after it ends (list_vehicles shows the day it ends)";
    case "VIGNETTE_VALIDITY_DATE_OUT_OF_RANGE":
      return "eToll does not sell a vignette starting on that date: quote again with a start date from today to a few weeks ahead";
    case "ORDER_TIMEOUT":
      return "the order expired unpaid; quote_vignette again and place a new order";
    case "TOLL_VERIFICATION_VEHICLE_NOT_ELIGIBLE":
      return "eToll says this vehicle cannot get a vignette as registered; check its category and details on portal.etoll.ro";
    case PRICE_CHANGED:
      return "nothing was paid: quote_vignette again and confirm the new price with the user before ordering";
    default:
      return "eToll refused it for the reason in the message; nothing was bought or changed";
  }
};

/**
 * What to do about it, in one sentence. The login sentence is built once
 * (loginRemedy) so that `needs_login` and the tool descriptions say the same
 * thing; the deployment may add the command that does it all.
 */
export const remedyFor = (error: AppError, loginHelp: string): string => {
  switch (error.kind) {
    case "config":
      return "fix the setting the message names (README, Configuration) and call again; nothing was sent to eToll";
    case "needs_login":
      return loginHelp;
    case "login_refused":
      return "do NOT call again until the user name or password is fixed (in the vault item or the password file): Keycloak locks an account after repeated failures; to sign in through the browser instead, call begin_login";
    case "not_found":
      return "check the id or plate number (list_vehicles, list_tolls, list_invoices give them; get_order knows only orders placed by this server); nothing was changed";
    case "input":
      return "fix what the message names and call again; nothing was changed";
    case "refused":
      return refusedRemedy(error);
    case "rate_limited":
      return "eToll is throttling this account; wait a minute and retry";
    case "outcome_unknown":
      return "eToll may have acted on it: do not repeat the call; an order it made is not listed anywhere until paid, nothing is charged unless its payment page is paid, and it expires by itself within the hour";
    case "api":
      return error.status === 0 ? "eToll or its sign-in server was unreachable; retry later, and service_status says whether CNAIR reports an outage" : "eToll failed; retry later, and service_status says whether CNAIR reports an outage";
    case "drift":
      return "eToll's API changed under this server (an answer no longer has the fields it had); the server needs updating, report it with the message";
    case "upstream":
      return "the vault MCP server failed: check the ETOLL_VAULT_* settings and that the vault is reachable and unlocked, then call again";
  }
};

/**
 * The sentence for a session that needs signing in. `script`, when the
 * deployment names one (ETOLL_LOGIN_SCRIPT), is the command that begins the
 * login, brings the user the link and completes it; the tools are named
 * either way, and so is the password, with which the server signs in by itself.
 */
export const loginRemedy = (script: string | undefined): string =>
  (script
    ? `run \`${script}\`: it begins the login, brings the user the link to open in their browser, and completes it; or, by hand: `
    : "") +
  "call begin_login (it answers with a URL and a deadline), have the USER open that URL and sign in to eToll there, " +
  "and pass the address the browser lands on (code=... and state=... in it) to complete_login. " +
  "With a password configured (ETOLL_USERNAME and ETOLL_PASSWORD_FILE, or a vault) the server signs in by itself instead";
