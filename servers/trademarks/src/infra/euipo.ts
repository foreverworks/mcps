import type { HttpRequest } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { RegisterPort } from "../app/ports.js";
import { driftError, fail, inputError } from "../domain/errors.js";
import { SOURCE } from "./euipo/credentials.js";
import { toDetail, toMark } from "./euipo/mapping.js";
import { rsqlOf } from "./euipo/rsql.js";
import { euipoDetail, euipoPage } from "./euipo/schema.js";

export { SOURCE };

/**
 * EU trade marks (EUTMs, and international registrations designating the EU)
 * through EUIPO's own Trademark Search API: documented (OpenAPI 1.1.0), free,
 * 25,000 calls a day on the default plan, behind an app subscription that
 * EUIPO approves (see the README for what that takes).
 */
const APPLICATION_NUMBER = /^[A-Za-z0-9]{3,20}$/;

const parsed = <T>(schema: z.ZodType<T>, body: unknown, what: string): T => {
  const result = schema.safeParse(body);
  return result.success ? result.data : fail(driftError(SOURCE, `${what} answered in an unknown shape: ${z.prettifyError(result.error).slice(0, 400)}`));
};

export const makeEuipoRegister = (http: HttpRequest, api: string): RegisterPort => {
  const base = api.replace(/\/+$/, "");
  return {
    office: "EM",
    source: SOURCE,
    official: true,
    similarity: "the name anywhere in the mark's words (EUIPO's API has no phonetic or fuzzy search)",
    // The search's RSQL takes the verbal element, classes, status and dates; goods and services come only with one mark's details.
    goods: false,
    search: async (query) => {
      const body = await http<unknown>(`${base}/trademarks`, { query: { query: rsqlOf(query), size: 100, page: 0, sort: "applicationDate:desc" } });
      const page = parsed(euipoPage, body, "GET /trademarks");
      return { found: page.totalElements, marks: page.trademarks.map(toMark) };
    },
    get: async (id) => {
      const number = id.trim();
      if (!APPLICATION_NUMBER.test(number)) return fail(inputError(`"${id}" is not an EUIPO application number`));
      const body = await http<unknown>(`${base}/trademarks/${encodeURIComponent(number)}`, { headers: { "accept-language": "en" } });
      return toDetail(parsed(euipoDetail, body, `GET /trademarks/${number}`));
    },
    probe: async () => {
      // The smallest page the API allows (10) of a query that matches nothing: proves the token and the subscription.
      parsed(euipoPage, await http<unknown>(`${base}/trademarks`, { query: { query: "applicationNumber==000000000", size: 10, page: 0 } }), "the probe");
    },
  };
};
