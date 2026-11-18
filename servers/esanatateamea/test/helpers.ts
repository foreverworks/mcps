/**
 * Shared test plumbing: a fake Keycloak (its Keycloakify login pages, the
 * token and logout endpoints) and a fake eSănătateaMea portal behind a stubbed
 * fetch, an in-memory vault MCP server, and a state dir in a temp folder. The
 * isolation setup refuses every other request; no test reaches a real account.
 *
 * Every value below is invented, in the shapes the portal answers (the
 * insurance, prescriptions and reimbursement summary as live answers had them
 * in 2026-11; the rest as the portal's own client code reads them). The login
 * pages carry only what this server reads from a real one: a `kcContext`
 * script with `pageId`, `loginAction` and, after a refusal, `message`.
 */
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addDays, InMemoryTransport, McpServer, type Transport, type UpstreamTransportFor } from "@foreverworks/mcp-kit";
import { vi } from "vitest";
import { z } from "zod";

import { todayIn } from "../src/domain/dates.js";
import { asAppError } from "../src/domain/errors.js";

export const ISSUER = "https://sso.esanatateamea.ro/realms/eSM";
export const PORTAL = "https://portal.esanatateamea.ro";
export const API = `${PORTAL}/api`;
export const AUTH_URL = `${ISSUER}/protocol/openid-connect/auth`;
export const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;
export const LOGOUT_URL = `${ISSUER}/protocol/openid-connect/logout`;
export const ACTION_URL = `${ISSUER}/login-actions/authenticate`;
export const REDIRECT = `${PORTAL}/env.js`;

export const stateDir = (): string => mkdtempSync(join(tmpdir(), "esanatateamea-state-"));

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** An unsigned JWT with these claims: enough for claimsOf, which checks no signature. */
export const jwt = (claims: Record<string, unknown>): string =>
  `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

export const CID = "cid-0001";
export const USER = { preferred_username: "ana.popescu@example.com", name: "Ana Popescu", email: "ana.popescu@example.com", sub: "kc-1", cid: CID };
export const USERNAME = "ana.popescu@example.com";
export const PASSWORD = "not-a-real-password";
export const OTP = "246810";

/** A Keycloak token answer. `n` numbers the access token so a renewal is visible in the bearer header. Offline: refresh_expires_in 0. */
export const tokenAnswer = (n: number, extra: Record<string, unknown> = {}) => ({
  access_token: jwt({ ...USER, exp: 4_000_000_000, n }),
  expires_in: 300,
  refresh_expires_in: 0,
  refresh_token: `refresh-${n}`,
  token_type: "Bearer",
  scope: "openid offline_access",
  ...extra,
});

export type Call = {
  readonly url: string;
  readonly method: string;
  readonly form?: Record<string, string>;
  /** A JSON body, parsed. */
  readonly body?: unknown;
  readonly authorization?: string;
  readonly cookie?: string;
  readonly query: Record<string, string>;
};

export type Routes = Readonly<Record<string, (call: Call) => Response | unknown>>;

/**
 * A fake Keycloak and portal: `routes` by `METHOD origin+path` (no query)
 * return a body or a Response. `calls` records everything.
 */
export const fakeNetwork = (routes: Routes) => {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const raw = typeof init?.body === "string" ? init.body : undefined;
      const type = headers.get("content-type") ?? "";
      const form = raw !== undefined && type.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : undefined;
      const body = raw !== undefined && type.includes("json") ? (JSON.parse(raw) as unknown) : undefined;
      const authorization = headers.get("authorization") ?? undefined;
      const cookie = headers.get("cookie") ?? undefined;
      const call: Call = {
        url: url.toString(),
        method,
        query: Object.fromEntries(url.searchParams),
        ...(form ? { form } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(authorization ? { authorization } : {}),
        ...(cookie ? { cookie } : {}),
      };
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

/**
 * A Keycloakify page: no form, only the `kcContext` its theme renders, the
 * action URL escaped the way the theme writes it (`\/`).
 */
export const keycloakHtml = (pageId: string, loginAction: string, message?: { readonly type: string; readonly summary: string }): string =>
  [
    "<!DOCTYPE html><html><head><title>eSănătateaMea</title><script>",
    "const kcContext = {",
    `  "pageId": "${pageId}",`,
    `  "loginAction": "${loginAction.replace(/\//g, "\\/")}",`,
    message === undefined ? "" : `  "message": { "type": "${message.type}", "summary": "${message.summary}" },`,
    '  "realm": { "name": "eSM" }',
    "};",
    "window.kcContext = kcContext;",
    '</script></head><body><div id="root"></div></body></html>',
  ].join("\n");

export const html = (body: string, cookies: readonly string[] = []): Response =>
  new Response(body, { status: 200, headers: [["content-type", "text/html;charset=utf-8"], ...cookies.map((c): [string, string] => ["set-cookie", c])] });

export const redirectTo = (location: string, cookies: readonly string[] = []): Response =>
  new Response(null, { status: 302, headers: [["location", location], ...cookies.map((c): [string, string] => ["set-cookie", c])] });

/**
 * Like servers/bitwarden: get_password answers the login as JSON, totp the
 * current code and its seconds left. `codes` is shared by every connection
 * (the server connects once per call): each totp answer takes the next one,
 * and the last one stays.
 */
export const vaultServer = (calls: string[], codes: { readonly code: string; readonly secondsLeft: number }[] = [{ code: OTP, secondsLeft: 20 }], item = "item-1") => {
  const server = new McpServer({ name: "fake-vault", version: "test" });
  server.registerTool("get_password", { inputSchema: { id: z.string() } }, async (args) => {
    calls.push(`get_password ${args.id}`);
    if (args.id !== item) return { content: [{ type: "text" as const, text: "no such item" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify({ id: item, name: "eSănătateaMea", username: USERNAME, password: PASSWORD }) }] };
  });
  server.registerTool("totp", { inputSchema: { id: z.string() } }, async (args) => {
    calls.push(`totp ${args.id}`);
    const answer = codes.length > 1 ? codes.shift() : codes[0];
    return { content: [{ type: "text" as const, text: JSON.stringify(answer) }] };
  });
  return server;
};

/** A transport that connects every endpoint to a fresh fake vault, in memory. */
export const inMemoryVault =
  (make: () => McpServer): UpstreamTransportFor =>
  async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await make().connect(serverSide as Transport);
    return clientSide as Transport;
  };

// ---- fixtures: every value invented ----------------------------------------------------

export const TODAY = todayIn(Date.now());
export const YEAR_AGO = addDays(TODAY, -365);

export const PERSON_INFORMATIONS = {
  statuses: [{ code: "AS", description: "Asigurat", validFrom: "2026-01-01T00:00:00", validTo: "2026-12-31T00:00:00" }],
  categories: [
    {
      categoryCode: "SAL",
      categoryDescription: "Salariat",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      estimatedUntil: "2027-03-31",
      approvedBy: "CAS EXEMPLU",
      reportedBy: "ANGAJATOR",
      code: "CASEX",
      notRead: "dropped by the schema",
    },
  ],
  medicalUnits: ["U0000001"],
};

export const INSURED = {
  state: "Asigurat",
  categories: [{ code: "SAL", validFrom: "2026-01-01", validTo: "2026-12-31" }],
  states: [{ code: "AS", validFrom: "2026-01-01", validTo: "2026-12-31" }],
  insurancePackages: [{ code: "PB", name: "Pachet de bază", validFrom: "2026-01-01" }],
  requestDate: "2026-11-18",
};

export const STATES = [
  { code: "AS", description: "Asigurat", validFrom: "2026-01-01", validTo: "2026-12-31" },
  { code: "NA", description: "Neasigurat", validFrom: "2025-06-01", validTo: "2025-12-31" },
];

export const DOMAINS = [
  { code: "MF", label: "Asistență medicală primară" },
  { code: "AMB", label: "Asistență medicală ambulatorie de specialitate" },
];

export const PRESCRIBED = {
  prescriptions: [
    {
      series: "CEX",
      no: "0000001",
      prescriptionDate: "2026-10-01T00:00:00",
      physicianStencilNo: "S00001",
      noDaysTreatment: 30,
      fractionNo: 1,
      diagnostic: "J06",
      drugs: [{ activeSubstance: "PARACETAMOLUM", concentration: "500mg", pharmaceuticalForm: "COMPR.", dose: "1 x 3/zi", prescriptedQuantity: 20, issuedQuantity: 20 }],
    },
  ],
};

export const RELEASED = {
  prescriptions: [
    {
      series: "CEX",
      no: "0000001",
      prescriptionDate: "2026-10-01",
      physicianStencilNo: "S00001",
      noDaysTreatment: 30,
      fractionNo: 1,
      prescriptionType: "Compensată 50%",
      copaymentValue: 12.35,
      drugs: [
        {
          drugName: "PARACETAMOL EXEMPLU 500 mg",
          drugCode: "W00001001",
          dose: "1 x 3/zi",
          prescriptedQuantity: 20,
          issuedQuantity: 20,
          drugIssueDate: "2026-10-02T09:15:00",
          pharmacyName: "Farmacia Exemplu",
          diagnosticCode: "J06",
          diagnosticDescription: "Infecție acută a căilor respiratorii superioare",
          noDaysAdministered: 7,
        },
      ],
    },
  ],
};

export const REIMBURSEMENTS = {
  totalPages: 1,
  totalElements: 1,
  pageSize: 20,
  body: [
    {
      id: 101,
      serviceDate: "2026-09-10",
      serviceType: "Ambulatoriu",
      serviceName: "Consultație",
      description: "Consultație de specialitate",
      doctorName: "Dr. Ion Exemplu",
      providerName: "Clinica Exemplu",
      location: "București",
      diagnosisCode: "J06",
      diagnosisName: "Infecție acută a căilor respiratorii superioare",
      reimbursedAmount: 45.67,
    },
  ],
};

export const REIMBURSEMENT_SUMMARY = { totalReimbursedAmount: 45.67, servicesCount: 1, previousServicesCount: 3, topProviders: [{ providerName: "Clinica Exemplu", totalAmount: 45.67, servicesCount: 1 }] };

export const DOCUMENTS = {
  totalPages: 1,
  totalElements: 1,
  pageSize: 20,
  body: [{ id: "doc-0001", displayTitle: "Bilet de trimitere", statusCode: "Raportat", doctorStencil: "S00001", issueDate: "2026-08-01" }],
};

export const DOCUMENT = {
  displayTitle: "Bilet de trimitere",
  documentType: "BT",
  sections: [
    {
      key: "medic",
      label: "Medic",
      fields: [
        { key: "nume", label: "Nume", value: "Dr. Ion Exemplu" },
        { key: "gol", label: "Gol", value: "" },
      ],
    },
    {
      key: "diagnostic",
      label: "Diagnostic",
      fields: [
        {
          key: "coduri",
          label: "Coduri",
          value: [
            [
              { key: "cod", label: "Cod", value: "J06" },
              { key: "denumire", label: "Denumire", value: "Infecție acută" },
            ],
          ],
        },
        { key: "urgent", label: "Urgent", value: false },
      ],
    },
    { key: "nimic", label: "Nimic", fields: [{ key: "x", label: "X", value: null }] },
  ],
};

const paged = (body: readonly unknown[]) => ({ totalPages: 1, totalElements: body.length, pageSize: 100, body });

export const EMERGENCY_ENTRIES = paged([{ id: "e-1", title: "Alergie", description: "Penicilină", typeName: "Alergii", typeGroup: "ALLERGY", source: "PACIENT" }]);
export const EMERGENCY_CONTACTS = paged([{ id: "c-1", firstName: "Ion", lastName: "Popescu", email: "ion.popescu@example.com", phone: "+44 7700 900123", relationship: "Frate", relationshipDetails: null }]);
export const DIRECTIVES = paged([]);

export const APPOINTMENT_COUNTS = { FUTURE: 1, WAITING: "0", PAST: 2, CANCELLED: null };

export const APPOINTMENTS = {
  totalPages: 1,
  totalElements: 1,
  pageSize: 20,
  body: [
    {
      id: "apt-0001",
      date: "2026-12-01 10:00",
      status: "CONFIRMED",
      details: "  ",
      doctorName: "Dr. Ion Exemplu",
      agencyName: null,
      specialtyName: "Cardiologie",
      serviceName: "Consultație",
      clinicalRoomName: "Cabinet 2",
      allocatedMinutes: 20,
      locationDetails: { agencyName: "Clinica Exemplu", adress: "Strada Exemplu 1", localityName: "București", regionName: "București" },
    },
  ],
};

export const PDF = new TextEncoder().encode("%PDF-1.7\n% invented\n");
