import type { Request } from "../../infra/httpJson.js";
import type { PeoplePort } from "../app/ports.js";
import type { Source } from "../domain/grants.js";
import type { RawDirectoryResponse, RawPerson, RawSearchResponse } from "../domain/schema.js";

/** The only file that knows the People API's URLs and parameter names. */
const BASE = "https://people.googleapis.com/v1";

/** What each source may return: "other contacts" take only these four. */
const MASKS: Readonly<Record<Source, string>> = {
  contacts: "names,emailAddresses,phoneNumbers,organizations",
  other: "names,emailAddresses,phoneNumbers",
  directory: "names,emailAddresses,phoneNumbers,organizations",
};

/** Google caps a contacts search at 30 results; the directory pages, and this server reads its first page. */
const CONTACTS_MAX = 30;
const DIRECTORY_MAX = 500;

/** How long a warmed search cache is trusted before the next search warms it again. */
const WARM_FOR_MS = 5 * 60 * 1000;

/**
 * Google asks a client to send one search with an empty query before a real
 * one, so the cache behind the search is filled ("Before searching, clients
 * should send a warmup request with an empty query to update the cache"). It
 * is sent before a source's first search and again once five minutes have
 * passed, so a long-running service still finds people added since.
 */
export const makePeopleApi = (request: Request, now: () => number = Date.now): PeoplePort => {
  const warmedAt = new Map<Source, number>();

  const contactSearch = (source: "contacts" | "other", query: string, pageSize: number) =>
    request<RawSearchResponse>(source === "contacts" ? `${BASE}/people:searchContacts` : `${BASE}/otherContacts:search`, {
      query: { query, pageSize, readMask: MASKS[source] },
    });

  const search = async (source: Source, query: string, limit: number): Promise<readonly RawPerson[]> => {
    if (source === "directory") {
      const page = await request<RawDirectoryResponse>(`${BASE}/people:searchDirectoryPeople`, {
        query: {
          query,
          pageSize: Math.min(limit, DIRECTORY_MAX),
          readMask: MASKS.directory,
          sources: ["DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE", "DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT"],
        },
      });
      return page.people ?? [];
    }
    const last = warmedAt.get(source);
    if (last === undefined || now() - last >= WARM_FOR_MS) {
      await contactSearch(source, "", 1);
      warmedAt.set(source, now());
    }
    const page = await contactSearch(source, query, Math.min(limit, CONTACTS_MAX));
    return (page.results ?? []).flatMap((r) => (r.person ? [r.person] : []));
  };

  return { search, probe: () => contactSearch("contacts", "", 1) };
};
