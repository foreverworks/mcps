import { type HttpAuth, type HttpFailure, type HttpOptions, type HttpRequest, makeHttp, NOT_JSON, OUTCOME_UNKNOWN } from "@foreverworks/mcp-kit";

import { type AppError, fail, needsLogin } from "../domain/errors.js";
import { errorBodyWire } from "../domain/schema.js";

/**
 * eToll's side of the kit's HTTP client (packages/mcp-kit, http.ts): which
 * answers mean "later" and what each failure becomes. The loop, the backoff,
 * the one renewal after a 401 and the rule that an order is never sent twice
 * blind are the kit's.
 *
 * The portal names its refusals with a code in `message`
 * (PENDING_ORDER_SAME_PRODUCT, VIGNETTE_OVERLAP, PLATE_NUMBER_FORMAT_INVALID)
 * and the sentence in `alertDetails`; such an answer is `refused` with the
 * code kept, whatever its status, so the remedy can be specific. A 401 after
 * the renewal is `needs_login`: eToll no longer honours the session.
 */
export type EtollHttpOptions = HttpOptions & { readonly fetch?: typeof fetch };

const CODE = /^[A-Z][A-Z0-9_]{2,}$/;

/** The portal's code in an error body, when it has one. */
export const reasonOf = (body: unknown): string | undefined => {
  const parsed = errorBodyWire.safeParse(body);
  if (!parsed.success) return undefined;
  const code = parsed.data.message ?? undefined;
  return code !== undefined && CODE.test(code) ? code : undefined;
};

/** The English sentence of an error body, else the Romanian, and the argument its code names. */
const detailsOf = (body: unknown): { readonly sentence: string | undefined; readonly parameter: string | undefined } => {
  const parsed = errorBodyWire.safeParse(body);
  if (!parsed.success) return { sentence: undefined, parameter: undefined };
  const { alertDetails, parameter } = parsed.data;
  return {
    sentence: alertDetails?.eng ?? alertDetails?.ro ?? undefined,
    parameter: typeof parameter === "string" && parameter !== "" ? parameter : typeof parameter === "number" ? String(parameter) : undefined,
  };
};

export const failureFor = (failure: HttpFailure): AppError => {
  switch (failure.kind) {
    case "transport":
      return { kind: "api", status: 0, message: failure.message };
    case OUTCOME_UNKNOWN:
      return { kind: "outcome_unknown", message: failure.message };
    case "rate_limited":
      return { kind: "rate_limited", message: failure.message };
    case "rejected": {
      if (failure.reason === NOT_JSON) return { kind: "drift", message: `${failure.message}: the answer is not JSON` };
      if (failure.status === 401) return needsLogin("refused", "eToll refused the session's token even after a refresh");
      const { status, reason } = failure;
      const { sentence, parameter } = detailsOf(failure.body);
      const said = `${failure.message} (${status}${reason ? ` ${reason}` : ""})${sentence ? `: ${sentence}` : ""}`;
      if (status === 404) return { kind: "not_found", status, message: said };
      if (reason !== undefined && status < 500) {
        return { kind: "refused", code: reason, status, message: said, ...(reason === "PENDING_ORDER_SAME_PRODUCT" && parameter !== undefined ? { pendingOrderId: parameter } : {}) };
      }
      if (status === 400 || status === 422) return { kind: "input", status, message: said };
      return { kind: "api", status, message: said };
    }
  }
};

/** 5xx is worth another attempt, for a read; the kit never retries an order. */
const isRetryable = (status: number): boolean => status >= 500 && status !== 501;

export const makeEtollHttp = (auth: HttpAuth | undefined, options: EtollHttpOptions = {}): HttpRequest =>
  makeHttp({
    service: "eToll",
    ...(auth ? { auth } : {}),
    isRetryable,
    reasonOf,
    fail: (failure) => fail(failureFor(failure)),
    attempts: 4,
    timeoutMs: 30_000,
    headers: { accept: "application/json", "user-agent": "foreverworks-mcps/etoll" },
    ...options,
  });
