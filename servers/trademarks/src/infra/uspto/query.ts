import type { SourceQuery } from "../../domain/query.js";

/**
 * The Elasticsearch query tmsearch.uspto.gov's own page builds
 * (`buildQueryTree` in its bundle, read 2026-10-05), narrowed to a mark's
 * text. Field names are the index's aliases: WM the word mark (its recorded
 * English translation included: a mark recorded as meaning the name matches
 * it), PM its pseudo-mark (what an examiner reads "4U" as), WMP5 a phonetic
 * form (it matches marks spelled with a d for a t, another vowel or a doubled
 * letter), IC the international classes as "009", LD live ("true") or dead.
 *
 * `exact` and `word` ask for the name as a phrase, and the use case keeps
 * only what is identical or contains it; `similar` adds the prefix, the
 * phonetic form and one or two letters' edit distance. A hundred candidates,
 * one request: enough that the identical ones are among them.
 *
 * Goods and services are GS, as the page's own "goods and services"
 * refinement asks them (`match_phrase` on GS; bundle read 2026-10-22): the
 * words together, in order, through the index's analyser. With goods asked
 * for, their text comes back too, so a mark matching only in a class it has
 * since cancelled can be left out (mapping.ts).
 */
export const CANDIDATES = 100;

export const SEARCH_FIELDS = [
  "id",
  "wordmark",
  "alive",
  "statusCode",
  "statusDescription",
  "filedDate",
  "registrationDate",
  "registrationId",
  "abandonDate",
  "cancelDate",
  "internationalClass",
  "ownerName",
  "drawingCode",
  "translation",
] as const;

export const DETAIL_FIELDS = [...SEARCH_FIELDS, "goodsAndServices"] as const;

const classCode = (n: number): string => String(n).padStart(3, "0");

export const searchBody = (query: SourceQuery) => {
  const name = query.name.trim();
  const single = !/\s/.test(name);
  const phrase = [
    { match_phrase: { WM: { query: name, boost: 5 } } },
    { match_phrase: { PM: { query: name, boost: 3 } } },
    ...(single ? [{ term: { WM: { value: name.toLowerCase(), boost: 6 } } }] : []),
  ];
  const close = [
    { match_phrase_prefix: { WM: { query: name, boost: 2 } } },
    { match_phrase: { WMP5: { query: name } } },
    { match: { WM: { query: name, fuzziness: "AUTO" } } },
  ];
  const filter = [
    ...(query.classes.length > 0 ? [{ terms: { IC: query.classes.map(classCode) } }] : []),
    ...(query.goods !== undefined ? [{ match_phrase: { GS: { query: query.goods } } }] : []),
    ...(query.status === "live" ? [{ term: { LD: "true" } }] : []),
  ];
  return {
    query: { bool: { should: query.match === "similar" ? [...phrase, ...close] : phrase, minimum_should_match: 1, ...(filter.length > 0 ? { filter } : {}) } },
    size: CANDIDATES,
    from: 0,
    track_total_hits: true,
    _source: query.goods === undefined ? SEARCH_FIELDS : [...SEARCH_FIELDS, "goodsAndServices"],
  };
};

/** One mark by serial number. */
export const detailBody = (serial: string) => ({
  query: { term: { id: serial } },
  size: 1,
  from: 0,
  track_total_hits: true,
  _source: DETAIL_FIELDS,
});

/**
 * The cheapest question with a known answer: does a record exist, counted, nothing returned.
 * The serial is USPTO's own example in its TSDR documentation, the same one the TSDR probe reads.
 */
export const probeBody = () => ({ query: { term: { id: "78787878" } }, size: 0, track_total_hits: true });
