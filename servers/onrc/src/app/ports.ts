/**
 * What the use cases need, as functions. Everything here is an interface the
 * infra layer satisfies; nothing in app/ or domain/ imports from infra/.
 */
import type { Claims } from "../domain/claims.js";
import type { PendingLogin } from "../domain/login.js";
import type { CalculationNoteWire, DocumentWire, InvoiceWire, RequestRowWire, RequestSummaryWire } from "../domain/schema.js";
import type { Issued, Session } from "../domain/session.js";

/** Seconds since the epoch. */
export type Clock = () => number;

export type Page = { readonly page: number; readonly size: number };

/** A list the portal pages: the items and whether more follow. */
export type Listed<T> = { readonly items: readonly T[]; readonly total: number | undefined; readonly last: boolean | undefined };

/** The portal's REST API, authenticated with the session. */
export type PortalPort = {
  readonly listRequests: (window: { readonly from: string; readonly to: string }, page: Page) => Promise<Listed<RequestRowWire>>;
  readonly requestSummary: (id: string) => Promise<RequestSummaryWire>;
  readonly requestDocuments: (id: string, page: Page) => Promise<Listed<DocumentWire>>;
  readonly listCalculationNotes: (window: { readonly from: string; readonly to: string }, page: Page) => Promise<Listed<CalculationNoteWire>>;
  readonly listInvoices: (window: { readonly from: string; readonly to: string }, page: Page) => Promise<Listed<InvoiceWire>>;
};

/** The session on disk: what is stored, replaced after a login, or dropped. */
export type SessionPort = {
  /** The stored session, or none. Never mints. */
  readonly read: () => Promise<Session | undefined>;
  /** Mint now, whatever is cached: the keepalive, and a caller who wants proof the session still works. */
  readonly rotate: () => Promise<Session>;
  readonly replace: (session: Session) => Promise<void>;
  /** Drop it: a logout, or Keycloak said the refresh token is dead. */
  readonly forget: () => Promise<void>;
};

/** The authorization-code flow against Keycloak. */
export type LoginPort = {
  readonly redirectUri: string;
  readonly authorizeUrl: (state: string, pkce: { readonly challenge: string; readonly method: "S256" }) => string;
  readonly exchangeCode: (code: string, redirectUri: string, verifier: string) => Promise<Issued>;
  /** Tell Keycloak the session is over (best effort: a dead refresh token is a success here). */
  readonly endSession: (refreshToken: string) => Promise<void>;
  readonly pending: {
    readonly read: () => Promise<PendingLogin | undefined>;
    readonly write: (p: PendingLogin) => Promise<void>;
    readonly clear: () => Promise<void>;
  };
};

export type Deps = {
  readonly portal: PortalPort;
  readonly session: SessionPort;
  readonly login: LoginPort;
  readonly claimsOf: (accessToken: string) => Claims;
  readonly now: Clock;
  readonly random: (bytes: number) => Uint8Array;
  /** Where the deployment says a login is run end to end, when it has such a command. */
  readonly loginScript: string | undefined;
};
