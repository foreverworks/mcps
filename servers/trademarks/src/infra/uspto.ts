import type { HttpRequest } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { RegisterPort } from "../app/ports.js";
import { driftError, fail, inputError } from "../domain/errors.js";
import { onlyInCancelled, toDetail, toMark } from "./uspto/mapping.js";
import { detailBody, probeBody, searchBody } from "./uspto/query.js";
import { usptoAnswer, type UsptoAnswer } from "./uspto/schema.js";

/**
 * The US register through the search backend of USPTO's own Trademark Search
 * page (tmsearch.uspto.gov, its configuration.json names the base). USPTO
 * documents no search API: TSDR answers by serial number only and needs a key
 * from an ID.me-verified account, and the Open Data Portal offers bulk files.
 * This backend answers a plain request without a key, and USPTO's terms ask
 * only that nobody load its servers ("unusually high numbers of database
 * accesses") or bulk-download through them, which one paced request per name
 * does not. It is undocumented and can change or close without notice; a
 * refusal is reported as such, and health says it is not an official API.
 */
export const SOURCE = "uspto-tmsearch";
export const USPTO_BASE = "https://tmsearch.uspto.gov/prod-stage-v1-0-0/";

/** Serial numbers are eight digits (registration numbers, seven, are not what it is looked up by). */
const SERIAL = /^\d{8}$/;

export const makeUsptoRegister = (http: HttpRequest, base: string = USPTO_BASE): RegisterPort => {
  const url = `${base.replace(/\/+$/, "")}/tmsearch`;
  const ask = async (json: unknown, what: string): Promise<UsptoAnswer> => {
    const body = await http<unknown>(url, { method: "POST", json, idempotent: true });
    const parsed = usptoAnswer.safeParse(body);
    return parsed.success ? parsed.data : fail(driftError(SOURCE, `${what} answered in an unknown shape: ${z.prettifyError(parsed.error).slice(0, 400)}`));
  };
  return {
    office: "US",
    source: SOURCE,
    official: false,
    similarity: "phonetic (USPTO's own sound-alike index), prefix, and one or two letters' edit distance",
    goods: true,
    search: async (query) => {
      const answer = await ask(searchBody(query), "a search");
      const hits = query.goods === undefined ? answer.hits.hits : answer.hits.hits.filter((h) => !onlyInCancelled(h.source.goodsAndServices, query.goods as string));
      return { found: answer.hits.totalValue, marks: hits.map((h) => toMark(h.source)) };
    },
    get: async (id) => {
      const serial = id.trim();
      if (!SERIAL.test(serial)) return fail(inputError(`"${id}" is not a USPTO serial number (8 digits)`));
      const hit = (await ask(detailBody(serial), `serial ${serial}`)).hits.hits[0];
      return hit === undefined ? fail({ kind: "not_found", message: `no US mark with serial number ${serial}` }) : toDetail(hit.source);
    },
    probe: async () => {
      await ask(probeBody(), "the probe");
    },
  };
};
