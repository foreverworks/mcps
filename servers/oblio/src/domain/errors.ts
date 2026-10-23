import { makeErrorKit, makeRequired, OUTCOME_UNKNOWN } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data.
 *
 * No classes and no `instanceof`: the tag is the discriminator, which survives
 * being serialised, crossing a module boundary, or being rebuilt from JSON.
 */
export type AppError =
  | { readonly kind: "auth"; readonly message: string }
  | {
      readonly kind: "api";
      readonly status: number;
      readonly message: string;
      /** `outcome_unknown` or `drift`; absent for an ordinary refusal. */
      readonly reason?: string;
      readonly body?: unknown;
    }
  /** The caller's arguments cannot become a request. Nothing was sent. */
  | { readonly kind: "input"; readonly message: string }
  | { readonly kind: "config"; readonly message: string };

export const authError = (message: string): AppError => ({ kind: "auth", message });

export const apiError = (
  status: number,
  message: string,
  extra: { readonly reason?: string; readonly body?: unknown } = {},
): AppError => ({
  kind: "api",
  status,
  message,
  ...(extra.reason === undefined ? {} : { reason: extra.reason }),
  ...(extra.body === undefined ? {} : { body: extra.body }),
});

export const inputError = (message: string): AppError => ({ kind: "input", message });
export const configError = (message: string): AppError => ({ kind: "config", message });

export const { fail, asAppError } = makeErrorKit<AppError>("oblio");

/**
 * The `reason` on a write that failed AFTER it may have reached Oblio: a
 * dropped connection or a 5xx on an issue or a delete. Such a call is never
 * retried blind, because the one thing worse than a failed invoice is the same
 * invoice issued twice, with two numbers, both reported to ANAF.
 */
export { OUTCOME_UNKNOWN };

/**
 * The `reason` on a response that does not have the shape Oblio documents.
 * Loud on purpose: a field that silently went missing is how a total becomes
 * zero on the way to an accounting file.
 */
export const DRIFT = "drift";

/**
 * A field the documented shape calls optional that this call cannot do
 * without: the number of a document just issued, the name of a company. The
 * wire types are honest that such a field may be absent; this is where the
 * code says what happens when one is, which is a loud failure rather than an
 * empty string travelling on.
 */
export const required = makeRequired((what) => fail(apiError(0, `Oblio's response had no ${what}`, { reason: DRIFT })));

/**
 * The `reason` on a document that WAS issued but whose total, read back from
 * Oblio, is not the one computed and confirmed: the document exists, so the
 * answer is to look at it, not to issue it again.
 */
export const TOTAL_MISMATCH = "total_mismatch";

/** Oblio's own throttle, documented at 30 requests per 100s for documents. */
export const TOO_MANY_REQUESTS = 429;

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return "point OBLIO_CONFIG at an app.json with client_id, client_secret and company_cif (see the README, Configuration)";
    case "auth":
      return "Oblio refused the client_id and secret; the secret is regenerated under Settings, Account Data";
    case "input":
      return "fix the arguments and call again";
    case "api":
      if (error.reason === OUTCOME_UNKNOWN)
        return "look the document up (get_invoice, or Oblio's web app) before calling again; retry only with the same idempotency_key";
      if (error.reason === DRIFT) return "Oblio's response changed shape; the server needs updating, report it";
      if (error.reason === TOTAL_MISMATCH)
        return "the document exists: open it (get_invoice or get_proforma) and cancel it if its total is wrong; do not issue it again";
      if (error.status === 401 || error.status === 403) return "the account cannot act on this company's CIF";
      if (error.status === TOO_MANY_REQUESTS)
        return "Oblio is throttling: 30 requests per 100s on documents, 30 per 10s elsewhere. Wait and retry";
      return error.status === 0 ? "Oblio was unreachable; retry later" : "read Oblio's message above; it names the field or the series";
  }
};
