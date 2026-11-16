/**
 * What the use cases need, as functions. Everything here is an interface the
 * infra layer satisfies; nothing in app/ or domain/ imports from infra/.
 */
import type { Claims } from "../domain/claims.js";
import type { PendingLogin } from "../domain/login.js";
import type { CursorPage } from "../domain/paging.js";
import type { OrderRequest, PaymentRequest, QuoteRequest, StoredOrder, StoredQuote } from "../domain/purchase.js";
import type {
  BillingDetailsWire,
  CheckoutWire,
  ComponentsWire,
  IncidentsWire,
  InvoicePageWire,
  NotificationWire,
  PaymentWire,
  ProfileWire,
  QuoteWire,
  SchedulesWire,
  TollWire,
  VehicleWire,
} from "../domain/schema.js";
import type { Issued, Session } from "../domain/session.js";

/** Seconds since the epoch. */
export type Clock = () => number;

export type TollFilter = { readonly status?: string | undefined; readonly plate?: string | undefined };

/** eToll's API, authenticated with the session. */
export type EtollPort = {
  readonly profile: () => Promise<ProfileWire>;
  readonly vehicles: (cursor: string | undefined) => Promise<CursorPage<VehicleWire>>;
  readonly tolls: (filter: TollFilter, cursor: string | undefined, size: number) => Promise<CursorPage<TollWire>>;
  readonly toll: (id: string) => Promise<TollWire>;
  /** Invoices in a window of instants (Bucharest's clock, with offset), a page by number from 0. */
  readonly invoices: (window: { readonly from: string; readonly to: string }, page: number, size: number) => Promise<InvoicePageWire>;
  readonly invoicePdf: (id: string) => Promise<Uint8Array>;
  readonly notifications: () => Promise<readonly NotificationWire[]>;
  readonly unreadNotifications: () => Promise<number | undefined>;
  readonly billingDetails: () => Promise<BillingDetailsWire>;
  readonly quote: (request: QuoteRequest) => Promise<readonly QuoteWire[]>;
  /** Creates an order. NOT idempotent: a failure after sending is `outcome_unknown`, never resent. */
  readonly createOrder: (request: OrderRequest) => Promise<CheckoutWire>;
  /** Asks for the order's payment page. NOT idempotent, like createOrder. */
  readonly pay: (orderId: string, request: PaymentRequest) => Promise<PaymentWire>;
  /** Drops an unpaid order; `gone` when eToll no longer has it. */
  readonly deleteOrder: (orderId: string) => Promise<"deleted" | "gone">;
};

/** CNAIR's public status page: no account, no session. */
export type StatusPort = {
  readonly components: () => Promise<ComponentsWire>;
  readonly incidents: () => Promise<IncidentsWire>;
  readonly schedules: () => Promise<SchedulesWire>;
};

/** The session on disk: what is stored, replaced after a login, or dropped. */
export type SessionPort = {
  /** The stored session, or none. Never mints. */
  readonly read: () => Promise<Session | undefined>;
  /** Mint now, whatever is cached: a caller who wants proof the session still works (or a fresh sign-in with the password). */
  readonly rotate: () => Promise<Session>;
  readonly replace: (session: Session) => Promise<void>;
  /** Drop it: a logout. */
  readonly forget: () => Promise<void>;
};

/** The browser sign-in: the authorization-code flow against Keycloak. */
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

export type Credentials = { readonly username: string; readonly password: string };

/** Where the password comes from, as health shows it: never the password, never its file's content. */
export type CredentialInfo =
  | { readonly kind: "none" }
  | { readonly kind: "file" | "variable"; readonly username: string | undefined }
  | { readonly kind: "mcp"; readonly transport: "http" | "stdio"; readonly tool: string; readonly item: string }
  | { readonly kind: "invalid"; readonly message: string };

/** The user name and password, read at a sign-in and never kept. */
export type CredentialSource = {
  readonly info: CredentialInfo;
  /** Whether a password sign-in is configured at all; without one, a dead session needs the browser. */
  readonly configured: boolean;
  readonly read: () => Promise<Credentials>;
};

/** Quotes and orders this server made, in its state dir. */
export type StorePort = {
  readonly saveQuotes: (quotes: readonly StoredQuote[]) => Promise<void>;
  readonly quote: (id: string) => Promise<StoredQuote | undefined>;
  readonly saveOrder: (order: StoredOrder) => Promise<void>;
  readonly order: (id: string) => Promise<StoredOrder | undefined>;
};

export type SavedFile = { readonly path: string; readonly sha256: string; readonly size: number };

export type OutboxPort = { readonly save: (name: string, bytes: Uint8Array) => Promise<SavedFile> };

export type Deps = {
  readonly etoll: EtollPort;
  readonly status: StatusPort;
  readonly session: SessionPort;
  readonly login: LoginPort;
  readonly credentials: CredentialSource;
  readonly store: StorePort;
  readonly outbox: OutboxPort;
  readonly claimsOf: (accessToken: string) => Claims;
  readonly now: Clock;
  readonly random: (bytes: number) => Uint8Array;
  /** Where the deployment says a browser sign-in is run end to end, when it has such a command. */
  readonly loginScript: string | undefined;
};
