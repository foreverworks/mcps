/**
 * Shared test plumbing: a fake Keycloak (token and logout endpoints) and a
 * fake eToll, behind a stubbed fetch, and a state dir in a temp folder. The
 * isolation setup refuses every other request; no grant reaches a real
 * account.
 *
 * The eToll answers below are invented, in the shapes the portal's own client
 * reads (its TollRO.Models types, read 2026-11-15); the error body and the
 * status page are in the shapes eToll was seen to answer. Dates are relative
 * to today in Bucharest, so a vignette's "days left" is the same on any day
 * the tests run.
 */
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addDays, InMemoryTransport, McpServer, type Transport, type UpstreamTransportFor } from "@foreverworks/mcp-kit";
import { vi } from "vitest";
import { z } from "zod";

import { bucharestDate, edges } from "../src/domain/dates.js";
import { asAppError } from "../src/domain/errors.js";

export const ISSUER = "https://sso.etoll.ro/auth/realms/external";
export const ORIGIN = "https://portal.etoll.ro";
export const API = `${ORIGIN}/api`;
export const STATUS = `${ORIGIN}/status/api`;
export const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;
export const LOGOUT_URL = `${ISSUER}/protocol/openid-connect/logout`;
export const REDIRECT = `${ORIGIN}/portal-extern/apm-env.js`;

export const stateDir = (): string => mkdtempSync(join(tmpdir(), "etoll-state-"));

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** An unsigned JWT with these claims: enough for claimsOf, which checks no signature. */
export const jwt = (claims: Record<string, unknown>): string =>
  `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

export const USER = { preferred_username: "ana.popescu@example.com", name: "Ana Popescu", email: "ana.popescu@example.com", sub: "kc-1" };
export const USERNAME = "ana.popescu@example.com";
export const PASSWORD = "not-a-real-password";

/** A Keycloak token answer. `n` numbers the access token so a renewal is visible in the bearer header. Offline: refresh_expires_in 0. */
export const tokenAnswer = (n: number, extra: Record<string, unknown> = {}) => ({
  access_token: jwt({ ...USER, exp: 4_000_000_000, n }),
  expires_in: 300,
  refresh_expires_in: 0,
  refresh_token: `refresh-${n}`,
  token_type: "Bearer",
  scope: "openid profile offline_access",
  ...extra,
});

export type Call = {
  readonly url: string;
  readonly method: string;
  readonly form?: Record<string, string>;
  /** A JSON body, parsed; `raw` is the text as sent. */
  readonly body?: unknown;
  readonly raw?: string | undefined;
  readonly authorization?: string;
  readonly query: Record<string, string>;
};

export type Routes = Readonly<Record<string, (call: Call) => Response | unknown>>;

/**
 * A fake Keycloak and eToll: `routes` by `METHOD origin+path` (no query)
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
      const call: Call = {
        url: url.toString(),
        method,
        query: Object.fromEntries(url.searchParams),
        ...(form ? { form } : {}),
        ...(body !== undefined ? { body, raw } : {}),
        ...(authorization ? { authorization } : {}),
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

/** The portal's error body, as eToll answers one. */
export const portalError = (status: number, code: string, eng: string, parameter?: string): Response =>
  json(
    {
      timestamp: "2026-11-15T10:00:00.000+00:00",
      status,
      error: status === 409 ? "Conflict" : "Bad Request",
      message: code,
      path: "/api/orders",
      alertStyle: "ERROR",
      alertDetails: { eng, ro: eng },
      ...(parameter === undefined ? {} : { parameter }),
      details: null,
    },
    status,
  );

/** Like servers/bitwarden: get_password answers the login's username and password as JSON. */
export const vaultServer = (calls: string[], item = "item-1") => {
  const server = new McpServer({ name: "fake-vault", version: "test" });
  server.registerTool("get_password", { inputSchema: { id: z.string() } }, async (args) => {
    calls.push(`get_password ${args.id}`);
    if (args.id !== item) return { content: [{ type: "text" as const, text: "no such item" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify({ id: item, name: "eToll", username: USERNAME, password: PASSWORD }) }] };
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

export const TODAY = bucharestDate(Date.now());
/** The day the current vignette ends, and the first a new one may cover. */
export const ENDS = addDays(TODAY, 10);
export const START = addDays(ENDS, 1);
export const UNTIL = addDays(START, 364);
/** A period as eToll writes one: its first and last instant in Bucharest, with the offset. */
const period = (from: string, to: string) => {
  const e = edges({ from, to });
  return { validFrom: e.from, validUntil: e.to };
};

export const VEHICLE = {
  id: "veh-0001",
  plateNumber: "B123ABC",
  countryCode: "RO",
  country: "Romania",
  countryType: "EU",
  category: "A",
  vehicleType: "CAR",
  vin: "TESTVIN0000000001",
  emissionStandard: "EURO_6",
  registrationSerial: null,
  favorite: true,
  isValid: true,
  temporaryPlate: false,
  mtma: 1500,
  vignetteEligibility: { eligibleIntervals: [{ start: `${START}T00:00:00`, end: `${addDays(TODAY, 60)}T23:59:59` }], expirationDateCurrentVignette: `${ENDS}T23:59:59` },
  isMutable: true,
};

export const VEHICLES = { vehicles: [VEHICLE], nextCursor: null };

export const PRICE = { totalPrice: 139.41, vat: 24.2, vatPercentage: 21, priceWithoutVat: 115.21 };

export const QUOTES = {
  quotes: [
    { duration: "TWELVE_MONTHS", price: PRICE, quantity: null, ...period(START, UNTIL) },
    { duration: "THIRTY_DAYS", price: { totalPrice: 34.85, vat: 6.05, vatPercentage: 21.0, priceWithoutVat: 28.8 }, quantity: null, ...period(START, addDays(START, 29)) },
  ],
};

/** A toll as the answer to POST orders holds it, unpaid: no id, status or orderId yet. */
export const ORDERED_TOLL = {
  id: null,
  type: "VIGNETTE",
  status: null,
  orderId: null,
  duration: "TWELVE_MONTHS",
  ...period(START, UNTIL),
  price: PRICE,
  vehicle: { id: VEHICLE.id, plateNumber: VEHICLE.plateNumber, countryCode: "RO", category: "A" },
  issuance: { externalId: "iss-0001", serialNo: null },
  refundable: false,
};

/** The same toll once paid, as list_tolls shows it. */
export const ACTIVE_TOLL = { ...ORDERED_TOLL, id: "toll-0001", type: 0, status: "ACTIVE", issuance: { externalId: "iss-0001", serialNo: "RO-TEST-0001" } };

/** Another vignette on the account, from an order before. */
export const EARLIER_TOLL = { ...ACTIVE_TOLL, id: "toll-0000", orderId: "ord-0000", issuance: { externalId: "iss-0000", serialNo: "RO-TEST-0000" } };

export const CHECKOUT = { orderId: "ord-0001", tolls: [ORDERED_TOLL], orderExpirationDate: new Date(Date.now() + 30 * 60_000).toISOString() };

export const PAYMENT = { id: "pay-0001", status: "NOT_PAID", paymentUrl: "https://secure.euplatesc.ro/tdsprocess/tranzactd.php?id=TEST0001", orderExpirationDate: CHECKOUT.orderExpirationDate };

export const PROFILE = { id: "prof-0001", name: "Ana Popescu", email: "ana.popescu@example.com", isCurrent: true };

export const PERSON = { id: "bp-0001", firstName: "Ana", lastName: "Popescu", isMutable: true, address: { city: "București", street: "Strada Exemplu 1" } };

export const COMPANY = { id: "bo-0001", name: "EXEMPLU S.R.L.", vatNumber: "RO12345678", registrationNo: "J40/0000/2020" };

export const BILLING = { persons: [PERSON], organisations: [] };

export const INVOICES = {
  invoices: [
    {
      id: "inv-0001",
      externalNumber: 1234,
      externalSeries: "ETL",
      externalNumberStr: "1234",
      paymentMethod: "CARD",
      paymentDate: "2026-10-01T10:00:00",
      buyerName: "Ana Popescu",
      total: PRICE,
      types: ["VIGNETTE"],
    },
  ],
  page: { number: 0, size: 20, totalElements: 1, totalPages: 1, first: true, last: true },
  countIsLowerBound: false,
};

export const NOTIFICATIONS = [{ id: "n-0001", createdAt: "2026-11-01T09:00:00", description: "Rovinieta pentru B123ABC expiră în curând.", isActive: true, status: "NEW", type: "VIGNETTE_EXPIRING", vehiclePlateNumber: "B123ABC" }];

const status = (value: number, human: string) => ({ value, human });
export const COMPONENTS = {
  data: [
    { id: "1", attributes: { name: "Portal", enabled: true, order: 1, status: status(1, "Operațional"), updated: { string: "2026-11-15 08:00:00" } } },
    { id: "2", attributes: { name: "Plăți", enabled: true, order: 2, status: status(3, "Întrerupere parțială"), updated: { string: "2026-11-15 09:00:00" } } },
  ],
};
export const INCIDENTS = {
  data: [
    { id: "7", attributes: { name: "Plăți cu cardul ", message: "Unele plăți eșuează.", status: status(2, "Identificat"), occurred: { string: "2026-11-15 09:00:00" } } },
    { id: "6", attributes: { name: "Vechi", message: "Rezolvat.", status: status(4, "Rezolvat"), occurred: { string: "2026-10-01 09:00:00" } } },
  ],
};
export const SCHEDULES = { data: [{ id: "3", attributes: { name: "Mentenanță", message: "Actualizare.", status: status(0, "Planificat"), scheduled: { string: "2026-11-20 01:00:00" }, completed: { string: "2026-11-20 03:00:00" } } }] };

export const PDF = new TextEncoder().encode("%PDF-1.7\n% invented\n");
