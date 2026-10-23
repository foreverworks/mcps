import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { asAppError } from "../src/domain/errors.js";
import { rsqlOf } from "../src/infra/euipo/rsql.js";
import { euipoDetail, euipoPage } from "./fixtures.js";
import { noSleep, stubFetch, type Answer, type Asked } from "./stubFetch.js";

const CREDENTIALS = { TRADEMARKS_SOURCES: "euipo", EUIPO_ENVIRONMENT: "sandbox", EUIPO_CLIENT_ID: "client-1", EUIPO_CLIENT_SECRET: "secret-1" };

const TOKEN = { access_token: "token-abc", token_type: "Bearer", expires_in: 7200 };

const emWith = (env: Record<string, string>, answer: (asked: Asked, n: number) => Answer) => {
  const stub = stubFetch(answer);
  const deps = buildDeps(env, { fetch: stub.fetch, sleep: noSleep, random: () => 0 });
  const em = deps.registers.find((r) => r.office === "EM");
  if (em === undefined) throw new Error("no EM register");
  return { em, asked: stub.asked };
};

const isToken = (a: Asked) => a.url.includes("oidc/accessToken");
const failureOf = async (p: Promise<unknown>) => asAppError(await p.then(() => undefined, (e: unknown) => e));

describe("the EUIPO query", () => {
  it("asks exact in every casing, since the spec does not say whether == ignores case", () => {
    expect(rsqlOf({ name: "Turnip", classes: [9, 35, 42], match: "exact", status: "live" })).toBe(
      "(wordMarkSpecification.verbalElement==Turnip or wordMarkSpecification.verbalElement==TURNIP or wordMarkSpecification.verbalElement==turnip) " +
        "and niceClasses=in=(9,35,42) and status=out=(WITHDRAWN,REFUSED,CANCELLED,SURRENDERED,EXPIRED,REMOVED_FROM_REGISTER)",
    );
  });

  it("asks word and similar as contains, quoting a name with a space", () => {
    expect(rsqlOf({ name: "blue night", classes: [], match: "similar", status: "all" })).toBe(
      '(wordMarkSpecification.verbalElement=="*blue night*" or wordMarkSpecification.verbalElement=="*BLUE NIGHT*" or wordMarkSpecification.verbalElement=="*Blue Night*")',
    );
    expect(rsqlOf({ name: 'a"b', classes: [], match: "word", status: "all" })).toContain('=="*a\\"b*"');
  });
});

describe("the EUIPO register", () => {
  it("is not configured without credentials, and sends nothing", async () => {
    const { em, asked } = emWith({ TRADEMARKS_SOURCES: "euipo" }, () => ({ json: {} }));
    expect(await failureOf(em.search({ name: "Turnip", classes: [], match: "exact", status: "live" }))).toMatchObject({ kind: "config", source: "euipo-api" });
    expect(await failureOf(em.probe())).toMatchObject({ kind: "config" });
    expect(asked).toHaveLength(0);
  });

  it("mints one client-credentials token for the sandbox, then searches with it and the client id", async () => {
    const { em, asked } = emWith(CREDENTIALS, (a) => (isToken(a) ? { json: TOKEN } : { json: euipoPage }));
    const page = await em.search({ name: "Turnip", classes: [9], match: "word", status: "live" });
    await em.search({ name: "Turnip", classes: [9], match: "word", status: "live" });

    const tokens = asked.filter(isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.url).toBe("https://auth-sandbox.euipo.europa.eu/oidc/accessToken");
    expect(Object.fromEntries(new URLSearchParams(tokens[0]?.body))).toEqual({ grant_type: "client_credentials", scope: "uid", client_id: "client-1", client_secret: "secret-1" });

    const search = asked.find((a) => !isToken(a));
    const url = new URL(search?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://api-sandbox.euipo.europa.eu/trademark-search/trademarks");
    expect(url.searchParams.get("query")).toContain("niceClasses=in=(9)");
    expect(url.searchParams.get("size")).toBe("100");
    expect(search?.headers).toMatchObject({ authorization: "Bearer token-abc", "x-ibm-client-id": "client-1" });

    expect(page.found).toBe(3);
    expect(page.marks[0]).toEqual({
      office: "EM",
      id: "018900001",
      mark: "Turnip",
      status: "registered",
      statusText: "REGISTERED",
      owners: ["Turnip Software Inc."],
      classes: [9, 42],
      kind: "word",
      filed: "2024-03-01",
      registered: "2024-07-10",
      link: "https://euipo.europa.eu/eSearch/#details/trademarks/018900001",
    });
    // Applicants are withheld until the fee is paid: an empty list, not a guess.
    expect(page.marks[1]).toMatchObject({ status: "pending", statusText: "OPPOSITION_PENDING", owners: [], kind: "figurative" });
  });

  it("renews the token once after a 401, then calls the API's refusal a subscription wait", async () => {
    const { em, asked } = emWith(CREDENTIALS, (a) => (isToken(a) ? { json: TOKEN } : { status: 401, json: { title: "Unauthorized", detail: "Invalid client id or secret." } }));
    expect(await failureOf(em.search({ name: "Turnip", classes: [], match: "exact", status: "live" }))).toMatchObject({ kind: "subscription", source: "euipo-api", status: 401 });
    expect(asked.filter(isToken)).toHaveLength(2);
  });

  it("says refused credentials at the token endpoint are an auth failure", async () => {
    const { em } = emWith(CREDENTIALS, () => ({ status: 401, json: { error: "invalid_client", error_description: "bad secret" } }));
    expect(await failureOf(em.probe())).toMatchObject({ kind: "auth", message: expect.stringContaining("invalid_client") });
  });

  it("reads one mark in English, the first language where English is missing", async () => {
    const { em, asked } = emWith(CREDENTIALS, (a) => (isToken(a) ? { json: TOKEN } : { json: euipoDetail }));
    const detail = await em.get("018900001");
    const get = asked.find((a) => !isToken(a));
    expect(get?.url).toBe("https://api-sandbox.euipo.europa.eu/trademark-search/trademarks/018900001");
    expect(get?.headers["accept-language"]).toBe("en");
    expect(detail).toMatchObject({
      expires: "2034-03-01",
      statusDate: "2024-07-11",
      goodsAndServices: [
        { class: 9, terms: "Software; Downloadable applications" },
        { class: 42, terms: "Logiciel-service [SaaS]" },
      ],
    });
  });

  it("uses production by default", async () => {
    const { em, asked } = emWith({ ...CREDENTIALS, EUIPO_ENVIRONMENT: "" }, (a) => (isToken(a) ? { json: TOKEN } : { json: euipoPage }));
    await em.probe();
    expect(asked.map((a) => new URL(a.url).host)).toEqual(["euipo.europa.eu", "api.euipo.europa.eu"]);
  });
});
