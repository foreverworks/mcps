/**
 * Enable Banking's wire shapes, GENERATED from the OpenAPI description the API's
 * owner publishes (generated/enablebanking.ts, `npm run gen:types`) rather than
 * written here. Type-only: nothing of it runs. The one import in domain/, on
 * purpose.
 *
 * Two adjustments on top of the generated types, both measured, never guessed:
 *
 * 1. **An optional field may arrive as `null`, not only absent.** The spec
 *    types `HalTransactions.continuation_key` as a string and its own prose says
 *    "Null if there are no more pages"; production sends the null (echo it
 *    back as the string "null" and the next page request fails with 422). Bank
 *    payloads carry `account_servicer: null` and `account_id.other: null` the
 *    same way. `Wire` widens every OPTIONAL field to `| null`, so the compiler
 *    makes the code say what it does with one (the kit's Wire, beside
 *    DeepReadonly). Required fields are taken at the spec's word.
 * 2. **An amount is typed `string | number`**, although the spec says string
 *    and Enable Banking sends one. The API is a facade over dozens of banks, a
 *    wrong type claim here is a TypeError on a real statement, and a JSON number
 *    has already lost precision in JSON.parse before any of this runs. The
 *    mapper flags such a row instead of presenting it as exact.
 */
import type { Wire } from "@foreverworks/mcp-kit";

import type { components } from "./generated/enablebanking.js";

type Schemas = components["schemas"];

export type PsuType = Schemas["PSUType"];

// --- requests: what this server sends, so the spec's own types -------------
export type StartAuthorizationRequest = Schemas["StartAuthorizationRequest"];
export type AuthorizeSessionRequest = Schemas["AuthorizeSessionRequest"];

// --- responses -------------------------------------------------------------
export type RawApplication = Wire<Schemas["GetApplicationResponse"]>;
export type RawAspspList = Wire<Schemas["GetAspspsResponse"]>;
export type RawAspsp = Wire<Schemas["ASPSPData"]>;
export type RawStartedAuthorization = Wire<Schemas["StartAuthorizationResponse"]>;
/**
 * POST /sessions, the code exchange. The ONLY response that carries the
 * accounts as objects (IBAN, name, currency, identification hashes); it is
 * also, verbatim, what sessions.json stores per label (see domain/sessions.ts).
 */
export type RawAuthorizedSession = Wire<Schemas["AuthorizeSessionResponse"]>;
/** GET /sessions/{id}: `accounts` are bare uid strings here, never objects. */
export type RawSession = Wire<Schemas["GetSessionResponse"]>;
/** An account object: on POST /sessions and from GET /accounts/{uid}/details. */
export type RawAccount = Wire<Schemas["AccountResource"]>;
export type RawAccountRef = Wire<Schemas["AccountIdentification"]>;

/** Point 2 above: the one field this file types wider than the spec. */
export type RawAmount = Omit<Wire<Schemas["AmountType"]>, "amount"> & { readonly amount: string | number };
export type RawTransaction = Omit<Wire<Schemas["Transaction"]>, "transaction_amount"> & {
  readonly transaction_amount: RawAmount;
};
export type RawTransactionPage = Omit<Wire<Schemas["HalTransactions"]>, "transactions"> & {
  readonly transactions: readonly RawTransaction[];
};
/** GET /accounts/{uid}/balances: one entry per balance type the bank reports. */
export type RawBalance = Omit<Wire<Schemas["BalanceResource"]>, "balance_amount"> & { readonly balance_amount: RawAmount };
export type RawBalancePage = Omit<Wire<Schemas["HalBalances"]>, "balances"> & { readonly balances: readonly RawBalance[] };
