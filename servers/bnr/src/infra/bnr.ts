import { makeHttp, type HttpFailure, type HttpOptions, type HttpRequest } from "@foreverworks/mcp-kit";

import type { RatesPort } from "../app/ports.js";
import { asAppError, fail, notFound } from "../domain/errors.js";
import type { RatesDocument } from "../app/ports.js";
import { ratesIn } from "./xml.js";

/**
 * BNR's published XML at curs.bnr.ro, the host the bank moved its files to
 * (its "Curs XML" page names it; every www.bnr.ro/*.xml path now redirects to
 * the HTML home page). Static files, no key:
 *
 * - `/nbrfxrates.xml`: the latest fixing, about 13:00 Bucharest on a banking day;
 * - `/files/xml/years/nbrfxrates<year>.xml`: every fixing of a year, the
 *   current one included (about 300 KB, measured 2026-10-18).
 *
 * A past year's file does not change, so it is kept for the life of the
 * process; the current year's and the latest are kept ten minutes. A file
 * first read while its year was current is incomplete, so it is kept ten
 * minutes like the current one, and only a read made once the year is over
 * keeps what it fetched for good.
 */
export const BNR_BASE = "https://curs.bnr.ro";
export const USER_AGENT = "mcps-bnr/1.0 (+https://github.com/foreverworks/mcps)";

const FRESH_MS = 10 * 60_000;

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

export type BnrOptions = HttpOptions & { readonly fetch?: typeof fetch; readonly base?: string };

export const makeBnr = (now: () => number, { fetch: injected, base = BNR_BASE, ...options }: BnrOptions = {}): RatesPort => {
  // The global is read at call time, so the kit's egress guard (and a test's isolation) is the one in force.
  const send: typeof fetch = injected ?? ((input, init) => fetch(input, init));
  const http: HttpRequest = makeHttp({
    service: "BNR",
    isRetryable: (status) => status === 429 || status >= 500,
    fail: failureFor,
    attempts: 3,
    timeoutMs: 30_000,
    headers: { "user-agent": USER_AGENT, accept: "application/xml, text/xml" },
    fetch: send,
    ...options,
  });
  const kept = new Map<string, { readonly at: number; readonly lasting: boolean; readonly document: Promise<RatesDocument> }>();

  const read = (path: string, lasting: boolean): Promise<RatesDocument> => {
    const hit = kept.get(path);
    // What was fetched as lasting is kept for good; anything else serves ten minutes, whatever this read asks.
    if (hit !== undefined && (hit.lasting || now() - hit.at < FRESH_MS)) return hit.document;
    const document = http<string>(`${base}${path}`, { as: "text" }).then((text) => ratesIn(text, path));
    kept.set(path, { at: now(), lasting, document });
    document.catch(() => kept.delete(path));
    return document;
  };

  return {
    year: (year, current) =>
      read(`/files/xml/years/nbrfxrates${year}.xml`, !current).catch((thrown: unknown) =>
        asAppError(thrown)?.kind === "not_found" ? fail(notFound(`BNR has no rates file for ${year} yet`)) : Promise.reject(thrown),
      ),
    latest: () => read("/nbrfxrates.xml", false),
  };
};
