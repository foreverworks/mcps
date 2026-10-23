/**
 * Shared test plumbing: a fake Keycloak (token and logout endpoints) and a
 * fake portal, both behind a stubbed fetch, and a state dir in a temp folder.
 * The isolation setup refuses every other request; no grant reaches a real
 * account.
 */
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { asAppError } from "../src/domain/errors.js";

export const ISSUER = "https://sso.onrc.ro/realms/onrc";
export const PORTAL = "https://myportal.onrc.ro";
export const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;
export const LOGOUT_URL = `${ISSUER}/protocol/openid-connect/logout`;

export const stateDir = (): string => mkdtempSync(join(tmpdir(), "onrc-state-"));

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** An unsigned JWT with these claims: enough for claimsOf, which checks no signature. */
export const jwt = (claims: Record<string, unknown>): string =>
  `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

export const USER = { preferred_username: "ana.popescu", name: "Ana Popescu", email: "ana.popescu@example.com", sub: "kc-1" };

/** A Keycloak token answer. `n` numbers the access token so a renewal is visible in the bearer header. */
export const tokenAnswer = (n: number, extra: Record<string, unknown> = {}) => ({
  access_token: jwt({ ...USER, exp: 4_000_000_000, n }),
  expires_in: 300,
  refresh_expires_in: 1800,
  refresh_token: `refresh-${n}`,
  token_type: "Bearer",
  scope: "openid",
  ...extra,
});

export type Call = { readonly url: string; readonly method: string; readonly form?: Record<string, string>; readonly authorization?: string; readonly query: Record<string, string> };

export type Routes = Readonly<Record<string, (call: Call) => Response | unknown>>;

/**
 * A fake Keycloak and portal: `routes` by `METHOD path` (the path without the
 * origin or query) return a body or a Response. `calls` records everything.
 */
export const fakeNetwork = (routes: Routes) => {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const form = typeof init?.body === "string" && headers.get("content-type")?.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(init.body)) : undefined;
      const authorization = headers.get("authorization") ?? undefined;
      const call: Call = { url: url.toString(), method, query: Object.fromEntries(url.searchParams), ...(form ? { form } : {}), ...(authorization ? { authorization } : {}) };
      calls.push(call);
      const route = routes[`${method} ${url.origin}${url.pathname}`];
      if (route === undefined) return new Response("no fake", { status: 404 });
      const out = route(call);
      return out instanceof Response ? out : json(out);
    }),
  );
  return calls;
};

export const challengeOf = (verifier: string): string => createHash("sha256").update(verifier, "ascii").digest("base64url");

export const errorOf = async (run: () => unknown) => {
  try {
    await run();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown);
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

// ---- fixtures: the portal's answers in the shape it gives; every value invented ----------

export const REQUEST_ID = "5d2c7e1a-0b3f-4a6d-9c8e-1f2a3b4c5d6e";

export const MENTIUNE = { id: "00000000-0000-4000-8000-000000000001", description: "Menţiune", registryCode: "ME", code: "002", oldCode: "M" };

export const REQUEST_ROW = {
  id: REQUEST_ID,
  applicationFormType: MENTIUNE,
  applicationFormSubtype: { id: "6e00", description: "Mentiune", registryCode: "MM", code: "085" },
  number: 20260001234,
  applicationRegistrationNumber: 4000123,
  creationDate: "2026-09-01T10:15:00",
  status: "WORKING",
  cancellable: false,
  cancellationPending: false,
  name: "MENTIUNI_PJ",
  hasNC: false,
  hasInvoice: false,
  companyName: "EXEMPLU S.R.L.",
  identificationCode: "12345678",
};

export const REQUESTS_PAGE = { content: [REQUEST_ROW], last: true, numberOfElements: 1, first: true, size: 10, number: 0, empty: false };

export const SUMMARY = {
  id: REQUEST_ID,
  applicationFormType: MENTIUNE,
  applicationFormSubtype: { id: "6e00", description: "Mentiune", registryCode: "MM", code: "085" },
  number: 20260001234,
  creationDate: "2026-09-01T10:15:00",
  status: "WORKING",
  requestNumberApp: 4000123,
  requestDateApp: "2026-09-01T10:15:00",
  appCode: "RC",
  requestTypeFlowName: "MENTIUNI_PJ",
  observations: [],
  hasFilesToDownload: false,
  hasAllCalculationNotesPayed: true,
  solutionTerm: "2026-09-08T00:00:00",
  releaseTerm: "2026-09-10T00:00:00",
  statusCode: "03",
  statusDescription: "Cerere inregistrata",
  communicationAssistanceResponse: false,
  hasCalculationNote: false,
  reportingToBeGenerated: false,
};

export const DOCUMENTS = {
  metadata: { page: 0, size: 10, pages: 1, total: 1 },
  data: [
    {
      documentTypeOpis: { id: "ad00", code: "486", name: "Cerere de înregistrare" },
      signed: false,
      deedNumber: "-",
      deedDate: "2026-09-01T10:05:00",
      issuer: "-",
      pagesNumber: 5,
      bucketName: "onrc.ptl",
      fileName: "cerere_pj_book_1_9_2026_10_05_signed.pdf",
      filePath: "/2026/9/1/x/cerere_pj_book_1_9_2026_10_05_signed.pdf",
      fileType: "CR",
      startDate: "2026-09-01",
      viewable: true,
      codMomentDepunere: "-",
      id: "7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b",
      // The portal repeats the signed-in person here, identity document included. No view may carry it.
      request: { id: REQUEST_ID, user: { username: "ana.popescu", uniqueId: "2990101999999", jsonDoc: "{\"idDocumentNumber\":\"000000\"}" } },
    },
  ],
};
