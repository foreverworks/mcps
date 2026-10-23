import { makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts).
 * `source` names the register a failure came from, so a search across offices
 * can report one office's failure and still answer for the others.
 */
export type AppError =
  /** A source's credentials are not set or cannot be read; nothing was sent. */
  | { readonly kind: "config"; readonly source: string; readonly message: string }
  /** The register's token endpoint refused the credentials, or TSDR refused its key. */
  | { readonly kind: "auth"; readonly source: string; readonly status: number; readonly message: string }
  /**
   * The credentials were accepted (a token was issued) but the API refused the call (401/403): the
   * app has no approved subscription to the product yet. A wait on the register, not a fault.
   */
  | { readonly kind: "subscription"; readonly source: string; readonly status: number; readonly message: string }
  /** The request cannot be answered as asked: a local check, or the register's 400 naming why. */
  | { readonly kind: "input"; readonly message: string; readonly detail?: unknown }
  | { readonly kind: "not_found"; readonly message: string }
  /** The office has no source here (domain/coverage.ts). */
  | { readonly kind: "unsupported"; readonly message: string }
  /** Still throttled after every retry. */
  | { readonly kind: "rate_limited"; readonly source: string; readonly status: number; readonly message: string }
  /** Any other refusal, a 5xx that outlived its retries, or no connection (status 0). */
  | { readonly kind: "api"; readonly source: string; readonly status: number; readonly message: string; readonly body?: unknown }
  /** A 2xx in a shape this server does not know, or a refusal of a query it built itself: the source changed. */
  | { readonly kind: "drift"; readonly source: string; readonly message: string };

export const inputError = (message: string, detail?: unknown): AppError =>
  detail === undefined ? { kind: "input", message } : { kind: "input", message, detail };
export const configError = (source: string, message: string): AppError => ({ kind: "config", source, message });
export const driftError = (source: string, message: string): AppError => ({ kind: "drift", source, message });

export const { fail, asAppError } = makeErrorKit<AppError>("trademarks");

/** The source of status histories and documents (infra/tsdr.ts): its failures need their own remedies. */
export const TSDR_SOURCE = "uspto-tsdr";

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      if (error.source === TSDR_SOURCE)
        return "USPTO's TSDR API needs a key: make one for the TSDR API at account.uspto.gov/profile/api-manager (a free USPTO.gov account) and give it to the server as USPTO_TSDR_API_KEY_FILE (see the server's README); until then read a mark's file by hand at tsdr.uspto.gov";
      return "the source has no credentials: EUIPO's API needs a client id and secret from an app subscribed to Trademark Search at dev.euipo.europa.eu (see the server's README); until then search EU marks by hand at https://euipo.europa.eu/eSearch";
    case "auth":
      if (error.source === TSDR_SOURCE)
        return "TSDR refused the key: check at account.uspto.gov/profile/api-manager that it is a TSDR API key (an Open Data Portal key is refused) and has not expired, then replace the service's key file";
      return "the register refused the client credentials: check the app's client id and secret at dev.euipo.europa.eu (Apps) against the service's credential files";
    case "subscription":
      return "EUIPO accepted the app's credentials but not the call: its Trademark Search subscription is missing or still waiting for EUIPO's approval (dev.euipo.europa.eu, Apps; EUIPO emails the account when it approves); until then search EU marks by hand at https://euipo.europa.eu/eSearch";
    case "input":
      return "fix what the message names and call again";
    case "not_found":
      return "check the office and the number: a USPTO serial number has 8 digits, an EUIPO application number 9 (leading zeros included)";
    case "unsupported":
      return "search that office by hand at the address the message gives; offices searchable here are listed by health";
    case "rate_limited":
      return "the register is throttling (TSDR allows 60 reads a minute per key, and 4 document downloads); wait a minute and ask for less at a time";
    case "api":
      return "retry once in a minute; if it persists, run health, and search that office by hand meanwhile (tmsearch.uspto.gov, euipo.europa.eu/eSearch)";
    case "drift":
      return "the register answered in a shape this server does not know; the US source is an undocumented backend that USPTO may change without notice, so compare with the server's README and fix the adapter";
  }
};
