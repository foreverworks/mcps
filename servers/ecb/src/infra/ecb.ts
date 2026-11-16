import { type HttpFailure, type HttpOptions, type HttpRequest, liveFetch, makeHttp } from "@foreverworks/mcp-kit";

import type { RatesDocument, RatesPort } from "../app/ports.js";
import { fail, notFound } from "../domain/errors.js";
import { ratesIn } from "./xml.js";

/**
 * The ECB's euro foreign exchange reference rates, three static XML files
 * under https://www.ecb.europa.eu/stats/eurofxref/, no key:
 *
 * - `eurofxref-daily.xml`: the latest fixing alone (1.5 KB);
 * - `eurofxref-hist-90d.xml`: the last 90 calendar days (70 KB, 65 fixings);
 * - `eurofxref-hist.xml`: everything since 1999-01-04 (8.2 MB, 960 KB gzipped,
 *   7,136 fixings and 41 currencies on 2026-11-13).
 *
 * All three change once per TARGET working day, around 16:00 CET, and the ECB
 * serves them with `cache-control: max-age=300`, so the two small files are
 * kept five minutes. The big one is read only for a day older than the 90-day
 * file reaches, whose rates do not change, so it is kept a day; a window that
 * runs on to today takes its newest fixings from the small files, never from
 * this one (app/usecases/fixings.ts). Measured on the 2026-11-13 file (7,136
 * fixings, 221,992 rates): about 0.25 s to parse and 18 MB of heap for the
 * parsed document once the text is released, so one copy is kept and nothing
 * is cached per query.
 */
export const ECB_BASE = "https://www.ecb.europa.eu/stats/eurofxref";
export const USER_AGENT = "mcps-ecb/1.0 (+https://github.com/foreverworks/mcps)";

const FRESH_MS = 5 * 60_000;
const HISTORY_FRESH_MS = 24 * 60 * 60_000;

const failureFor = (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail({ kind: "api", status: 0, message: failure.message });
    case "outcome_unknown":
    case "rate_limited":
      return fail({ kind: "api", status: failure.status, message: failure.message });
    case "rejected":
      return failure.status === 404 ? fail(notFound(failure.message)) : fail({ kind: "api", status: failure.status, message: failure.message });
  }
};

export type EcbOptions = HttpOptions & { readonly fetch?: typeof fetch; readonly base?: string };

export const makeEcb = (now: () => number, { fetch: injected, base = ECB_BASE, ...options }: EcbOptions = {}): RatesPort => {
  const send: typeof fetch = injected ?? liveFetch;
  const http: HttpRequest = makeHttp({
    service: "the ECB",
    isRetryable: (status) => status === 429 || status >= 500,
    fail: failureFor,
    attempts: 3,
    timeoutMs: 60_000,
    headers: { "user-agent": USER_AGENT, accept: "application/xml, text/xml" },
    fetch: send,
    ...options,
  });
  const kept = new Map<string, { readonly at: number; readonly document: Promise<RatesDocument> }>();

  const read = (file: string, freshMs: number): Promise<RatesDocument> => {
    const hit = kept.get(file);
    if (hit !== undefined && now() - hit.at < freshMs) return hit.document;
    const document = http<string>(`${base}/${file}`, { as: "text" }).then((text) => ratesIn(text, file));
    kept.set(file, { at: now(), document });
    document.catch(() => kept.delete(file));
    return document;
  };

  return {
    latest: () => read("eurofxref-daily.xml", FRESH_MS),
    recent: () => read("eurofxref-hist-90d.xml", FRESH_MS),
    history: () => read("eurofxref-hist.xml", HISTORY_FRESH_MS),
  };
};
