/** Contacts and the directory against a fake port and a recording request layer. Invented data only. */
import { describe, expect, it } from "vitest";

import type { Deps, PeoplePort } from "../../src/contacts/app/ports.js";
import { checkHealth, findPeople } from "../../src/contacts/app/usecases.js";
import { apiError, asAppError, authError, fail } from "../../src/contacts/domain/errors.js";
import { mergePeople } from "../../src/contacts/domain/people.js";
import { CONTACTS_OTHER_READONLY, CONTACTS_READONLY, DIRECTORY_READONLY, type Source } from "../../src/contacts/domain/grants.js";
import type { RawPerson } from "../../src/contacts/domain/schema.js";
import { makePeopleApi } from "../../src/contacts/infra/peopleApi.js";
import type { Request, RequestSpec } from "../../src/infra/httpJson.js";

const person = (name: string, email?: string, extra: Partial<RawPerson> = {}): RawPerson => ({
  names: [{ displayName: name }],
  ...(email ? { emailAddresses: [{ value: email }] } : {}),
  ...extra,
});

const account = (label: string, found: Partial<Record<Source, readonly RawPerson[] | "refused">>, scopes = [CONTACTS_READONLY, CONTACTS_OTHER_READONLY, DIRECTORY_READONLY]): Deps => {
  const people: PeoplePort = {
    search: async (source) => {
      const answer = found[source] ?? [];
      if (answer === "refused") return fail(apiError(400, "Must be a G Suite domain user.", { reason: "FAILED_PRECONDITION" }));
      return answer;
    },
    probe: async () => ({}),
  };
  return { grant: { account: label, credentials: `/creds/${label}.json`, scopes: async () => scopes, whoami: async () => `${label}@example.com` }, people };
};

const ALL: Source[] = ["contacts", "other", "directory"];

describe("findPeople", () => {
  it("merges one person found in several accounts and sources into one entry, contacts first", async () => {
    const out = await findPeople(
      [
        account("personal", { other: [person("ana popescu", "Ana.Popescu@example.org")], contacts: [person("Ana Popescu", "ana@example.com")] }),
        account("work", { directory: [person("Ana Popescu", "ana.popescu@example.org", { organizations: [{ name: "Example SRL", title: "Engineer" }] })] }),
      ],
      { query: "Ana", sources: ALL, limit: 10 },
    );
    expect(out.people).toEqual([
      { name: "Ana Popescu", emails: ["ana@example.com"], foundIn: [{ account: "personal", source: "contacts" }] },
      {
        name: "Ana Popescu",
        emails: ["ana.popescu@example.org"],
        organization: "Example SRL",
        title: "Engineer",
        foundIn: [
          { account: "work", source: "directory" },
          { account: "personal", source: "other" },
        ],
      },
    ]);
  });

  it("says which source an account could not read, and why, instead of reading it as nobody", async () => {
    const out = await findPeople(
      [account("personal", { directory: "refused" }), account("work", {}, [CONTACTS_READONLY, CONTACTS_OTHER_READONLY])],
      { query: "Ion", sources: ["directory"], limit: 10 },
    );
    expect(out.people).toEqual([]);
    expect(out.unavailable).toEqual([
      { account: "personal", source: "directory", reason: expect.stringContaining("Workspace") },
      { account: "work", source: "directory", reason: expect.stringContaining("directory.readonly") },
    ]);
  });

  it("keeps a dead account to itself: its sources are unavailable, the others still answer", async () => {
    const dead: Deps = { ...account("work", {}), grant: { ...account("work", {}).grant, scopes: async () => fail(authError("invalid_grant", "Token has been expired or revoked.")) } };
    const out = await findPeople([account("personal", { contacts: [person("Ion Ionescu", "ion@example.com")] }), dead], { query: "Ion", sources: ["contacts", "other"], limit: 10 });
    expect(out.people.map((p) => p.name)).toEqual(["Ion Ionescu"]);
    expect(out.unavailable).toEqual([
      { account: "work", source: "contacts", reason: expect.stringContaining("invalid_grant") },
      { account: "work", source: "other", reason: expect.stringContaining("invalid_grant") },
    ]);
  });

  it("joins entries a later person's addresses connect, and keeps someone found by phone alone", () => {
    const merged = mergePeople([
      { account: "personal", source: "contacts", person: person("Ana", "a@example.com") },
      { account: "personal", source: "contacts", person: person("Ana Popescu", "b@example.com") },
      { account: "work", source: "directory", person: person("Ana Popescu", undefined, { emailAddresses: [{ value: "A@example.com" }, { value: "b@example.com" }] }) },
      { account: "personal", source: "contacts", person: person("Plumber", undefined, { phoneNumbers: [{ value: "0700 000 000", canonicalForm: "+40700000000" }] }) },
    ]);
    expect(merged).toEqual([
      {
        name: "Ana",
        emails: ["a@example.com", "b@example.com"],
        foundIn: [
          { account: "personal", source: "contacts" },
          { account: "work", source: "directory" },
        ],
      },
      { name: "Plumber", emails: [], phones: ["+40700000000"], foundIn: [{ account: "personal", source: "contacts" }] },
    ]);
  });

  it("refuses an empty query before asking Google", async () => {
    const thrown: unknown = await findPeople([account("personal", {})], { query: "  ", sources: ALL, limit: 10 }).catch((t: unknown) => t);
    expect(asAppError(thrown)).toMatchObject({ kind: "input" });
  });

  it("reports in health which sources a grant reads, a personal account without the directory still healthy", async () => {
    const h = await checkHealth(account("personal", {}, [CONTACTS_READONLY, CONTACTS_OTHER_READONLY]));
    expect(h).toMatchObject({ ok: true, api: "enabled", sources: { contacts: true, other: true, directory: false } });
  });
});

describe("the People adapter", () => {
  it("warms the cache again once five minutes have passed, so a long-running service finds people added since", async () => {
    const queries: string[] = [];
    let clock = 0;
    const request = (async (_url: string, spec: RequestSpec = {}) => (queries.push(String(spec.query?.["query"])), { results: [] })) as unknown as Request;
    const api = makePeopleApi(request, () => clock);
    await api.search("contacts", "Ana", 5);
    clock = 4 * 60 * 1000;
    await api.search("contacts", "Ion", 5);
    clock = 9 * 60 * 1000;
    await api.search("contacts", "Dan", 5);
    expect(queries).toEqual(["", "Ana", "Ion", "", "Dan"]);
  });

  it("warms a contacts search once with an empty query, and asks the directory for profiles and shared contacts", async () => {
    const calls: { url: string; spec: RequestSpec }[] = [];
    const request = (async (url: string, spec: RequestSpec = {}) => (calls.push({ url, spec }), { results: [{ person: person("Ana", "ana@example.com") }], people: [] })) as unknown as Request;
    const api = makePeopleApi(request);
    await api.search("contacts", "Ana", 50);
    await api.search("contacts", "Ion", 5);
    await api.search("other", "Ana", 5);
    await api.search("directory", "Ana", 5);
    expect(calls.map((c) => `${c.url.replace("https://people.googleapis.com/v1/", "")} ${String(c.spec.query?.["query"])} ${String(c.spec.query?.["pageSize"])}`)).toEqual([
      "people:searchContacts  1",
      "people:searchContacts Ana 30",
      "people:searchContacts Ion 5",
      "otherContacts:search  1",
      "otherContacts:search Ana 5",
      "people:searchDirectoryPeople Ana 5",
    ]);
    expect(calls[3]?.spec.query?.["readMask"]).toBe("names,emailAddresses,phoneNumbers");
    expect(calls[5]?.spec.query?.["sources"]).toEqual(["DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE", "DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT"]);
  });
});
