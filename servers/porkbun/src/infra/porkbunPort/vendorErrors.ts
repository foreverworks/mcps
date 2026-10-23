import type { AppError } from "../../domain/errors.js";

/**
 * The vendor's tools throw a plain `Error` whose MESSAGE is the only record of
 * what went wrong (dist/api.js `call`, `callPublic`, `fetchDoc`, and the
 * argument checks in dist/tools.js). This sorts those messages into kinds, in
 * this one place; `test/vendorErrors.test.ts` produces each message from the
 * pinned package itself, so a reworded message fails there, not in a session.
 *
 * Returns undefined for a throw that is none of these (not an Error, or a
 * TypeError from the vendor's own code): that is a bug, and the kit reports it
 * as `unexpected`.
 */

/** `Porkbun API error [CODE]: message — next: hint (url)`, or `Porkbun API error: HTTP 500`. */
const API_ERROR = /^Porkbun API error(?: \[([A-Z0-9_]+)\])?: /;
/** `Porkbun API returned non-JSON response (HTTP 502): ...`, `Porkbun docs request failed (HTTP 404) for ...`. */
const HTTP_FAILURE = /^Porkbun (?:API returned non-JSON response|docs request failed) \(HTTP (\d+)\)/;
/** The vendor's check that a key pair was configured, before any request. */
const NO_CREDENTIALS = /^This tool needs Porkbun API credentials/;
/** What mcp-kit's egress filter puts on the TypeError it throws (packages/mcp-kit/src/egress.ts). */
const EGRESS_DENIED = "EGRESS_DENIED";

const causeCode = (error: Error): unknown => (error.cause as { code?: unknown } | undefined)?.code;

/**
 * Porkbun's keys (`pk1_...`, `sk1_...`) blanked out of a message. The vendor
 * puts up to 300 characters of a non-JSON answer into its error, and a proxy's
 * error page can echo the request's headers, which carry the pair
 * (X-API-Key, X-Secret-API-Key); the message becomes a tool result.
 */
const KEY = /\b(pk1|sk1)_[A-Za-z0-9_]+/g;
const withoutKeys = (text: string): string => text.replace(KEY, "$1_[redacted]");

export const classifyVendorError = (thrown: unknown): AppError | undefined => {
  if (!(thrown instanceof Error)) return undefined;
  const message = withoutKeys(thrown.message);
  // fetch rejects with a TypeError that has a cause: no answer from Porkbun, or a host this process
  // may not reach. A TypeError without one is a bug in the vendor's code, reported as unexpected.
  if (thrown instanceof TypeError) {
    if (thrown.cause === undefined) return undefined;
    return causeCode(thrown) === EGRESS_DENIED ? { kind: "egress", message } : { kind: "network", message };
  }
  if (NO_CREDENTIALS.test(message)) return { kind: "config", message: "no Porkbun API key pair is configured for this server" };
  const api = API_ERROR.exec(message);
  if (api !== null) return { kind: "api", message, ...(api[1] === undefined ? {} : { code: api[1] }) };
  const http = HTTP_FAILURE.exec(message);
  if (http !== null) return { kind: "api", message, status: Number(http[1]) };
  return { kind: "refused", message };
};
