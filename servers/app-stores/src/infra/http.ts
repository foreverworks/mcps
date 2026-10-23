import { makeHttp, NOT_JSON, type HttpAuth, type HttpFailure, type HttpOptions, type HttpRequest } from "@foreverworks/mcp-kit";

import { type AppError, fail, type Store } from "../domain/errors.js";

/**
 * The stores' side of the kit's HTTP client (packages/mcp-kit, http.ts): what
 * each answer becomes. Reads repeat after a 5xx or a dropped connection; a
 * reply is a POST, never sent twice blind (`outcome_unknown`).
 *
 * Both stores say why in the body: App Store Connect as JSON:API errors
 * (`{"errors": [{"status", "code", "title", "detail"}]}`), Google as
 * `{"error": {"code", "message", "status"}}`.
 */
export type StoreHttpOptions = HttpOptions & { readonly fetch?: typeof fetch };

const NAMES: Readonly<Record<Store, string>> = { app_store: "App Store Connect", play: "Google Play" };

/** The store's own words for a refusal, when the body has them. */
export const detailOf = (body: unknown): string | undefined => {
  const asc = (body as { readonly errors?: readonly { readonly title?: unknown; readonly detail?: unknown }[] } | null)?.errors?.[0];
  if (asc !== undefined) return [asc.title, asc.detail].filter((t): t is string => typeof t === "string" && t !== "").join(": ") || undefined;
  const google = (body as { readonly error?: { readonly message?: unknown } } | null)?.error?.message;
  return typeof google === "string" && google !== "" ? google : undefined;
};

const failureFor =
  (store: Store) =>
  (failure: HttpFailure): never => {
    const error = ((): AppError => {
      switch (failure.kind) {
        case "transport":
          return { kind: "api", store, status: 0, message: failure.message };
        case "outcome_unknown":
          return { kind: "outcome_unknown", store, message: failure.message };
        case "rate_limited":
          return { kind: "rate_limited", store, message: failure.message };
        case "rejected": {
          const { status } = failure;
          if (failure.reason === NOT_JSON) return { kind: "drift", store, message: `${failure.message}: the answer is not JSON` };
          const message = detailOf(failure.body) ?? failure.message;
          if (status === 401) return { kind: "auth", store, status, message };
          if (status === 403) return { kind: "forbidden", store, status, message };
          if (status === 404) return { kind: "not_found", message };
          if (status === 400 || status === 409 || status === 422) return { kind: "input", message };
          return { kind: "api", store, status, message };
        }
      }
    })();
    return fail(error);
  };

export const makeStoreHttp = (store: Store, auth: HttpAuth | undefined, options: StoreHttpOptions = {}): HttpRequest =>
  makeHttp({
    service: NAMES[store],
    ...(auth === undefined ? {} : { auth }),
    isRetryable: (status) => status === 429 || status >= 500,
    fail: failureFor(store),
    attempts: 3,
    timeoutMs: 30_000,
    headers: { "user-agent": "foreverworks-mcps/app-stores", accept: "application/json" },
    ...options,
  });
