/**
 * What the use cases need, as functions. Everything here is an interface the
 * infra layer satisfies; nothing in app/ or domain/ imports from infra/.
 */
import type { Claims } from "../domain/claims.js";
import type { PendingCode, PendingLogin } from "../domain/login.js";
import type {
  AppointmentCountsWire,
  AppointmentWire,
  DirectiveWire,
  DocumentDetailWire,
  DocumentRowWire,
  EmergencyContactWire,
  EmergencyEntryWire,
  InsuredWire,
  PackageDomainWire,
  Paged,
  PersonInformationsWire,
  PrescribedWire,
  ReimbursementRowWire,
  ReimbursementSummaryWire,
  ReleasedWire,
  StateRowWire,
} from "../domain/schema.js";
import type { Issued, Session } from "../domain/session.js";

/** Seconds since the epoch. */
export type Clock = () => number;

/** Days, YYYY-MM-DD, as the portal's calendar has them (Bucharest). */
export type DayWindow = { readonly from: string; readonly to: string };

/** Which of the portal's appointment tabs: as "Programările mele" splits them. */
export type AppointmentTab = "upcoming" | "waiting" | "past" | "cancelled";

/** eSănătateaMea's APIs, authenticated with the session. Every one is a read. */
export type PortalPort = {
  readonly personInformations: () => Promise<PersonInformationsWire>;
  readonly insured: () => Promise<InsuredWire>;
  readonly insuranceHistory: () => Promise<readonly StateRowWire[]>;
  readonly packageDomains: (packageName: string) => Promise<readonly PackageDomainWire[]>;
  readonly prescribed: (window: DayWindow) => Promise<PrescribedWire>;
  readonly released: (window: DayWindow) => Promise<ReleasedWire>;
  readonly reimbursements: (window: DayWindow, page: number, size: number) => Promise<Paged<ReimbursementRowWire>>;
  readonly reimbursementSummary: (window: DayWindow) => Promise<ReimbursementSummaryWire>;
  readonly documents: (filter: { readonly window: DayWindow | undefined; readonly search: string | undefined }, page: number, size: number) => Promise<Paged<DocumentRowWire>>;
  readonly document: (id: string) => Promise<DocumentDetailWire>;
  readonly documentPdf: (id: string) => Promise<Uint8Array>;
  readonly emergencyEntries: () => Promise<readonly EmergencyEntryWire[]>;
  readonly emergencyContacts: () => Promise<readonly EmergencyContactWire[]>;
  readonly advanceDirectives: () => Promise<readonly DirectiveWire[]>;
  readonly emergencyPdf: () => Promise<Uint8Array>;
  readonly appointmentCounts: (cid: string) => Promise<AppointmentCountsWire>;
  readonly appointments: (cid: string, tab: AppointmentTab, nowLocal: string, page: number, size: number) => Promise<Paged<AppointmentWire>>;
};

/** The session on disk: what is stored, replaced after a login, or dropped. */
export type SessionPort = {
  /** The stored session, or none. Never mints. */
  readonly read: () => Promise<Session | undefined>;
  /** Mint now, whatever is cached: a caller who wants proof the session still works (or a fresh sign-in with the password). */
  readonly rotate: () => Promise<Session>;
  /** A password sign-in now, whatever is stored (begin_login with method password). */
  readonly signIn: () => Promise<Session>;
  readonly replace: (session: Session) => Promise<void>;
  /** Drop it: a logout. */
  readonly forget: () => Promise<void>;
};

/** Signing in at Keycloak: the password form and the ROeID leg through the user's browser. */
export type LoginPort = {
  readonly redirectUri: string;
  /** The authorize URL; `idp` hands the browser straight to that identity provider (ROeID). */
  readonly authorizeUrl: (state: string, pkce: { readonly challenge: string; readonly method: "S256" }, idp?: string) => string;
  readonly exchangeCode: (code: string, redirectUri: string, verifier: string) => Promise<Issued>;
  /** The password form, from its first page to a code, or to the authenticator step it stopped at. */
  readonly passwordForm: (
    begun: PendingLogin,
    credentials: Credentials,
  ) => Promise<{ readonly kind: "code"; readonly code: string } | { readonly kind: "needs_code"; readonly pending: PendingCode }>;
  /** The authenticator's six digits on the step that asked for them: the code to exchange. */
  readonly submitCode: (pending: PendingCode, otp: string) => Promise<string>;
  /** Tell Keycloak the session is over (best effort: a dead refresh token is a success here). */
  readonly endSession: (refreshToken: string) => Promise<void>;
  readonly pending: {
    readonly read: () => Promise<PendingLogin | undefined>;
    readonly write: (p: PendingLogin) => Promise<void>;
    readonly clear: () => Promise<void>;
  };
  readonly pendingCode: {
    readonly read: () => Promise<PendingCode | undefined>;
    readonly write: (p: PendingCode) => Promise<void>;
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

/** Where the authenticator code comes from. */
export type CodeInfo = { readonly kind: "file" | "variable" } | { readonly kind: "mcp"; readonly tool: string };

export type CodeSource = { readonly info: CodeInfo; readonly read: () => Promise<string> };

/** The user name and password, read at a sign-in and never kept; and the code, when something here can read it. */
export type CredentialSource = {
  readonly info: CredentialInfo;
  /** Whether a password sign-in is configured at all; without one, a dead session needs ROeID. */
  readonly configured: boolean;
  /** Undefined when the code must come from the user (complete_login with otp). */
  readonly code: CodeSource | undefined;
  readonly read: () => Promise<Credentials>;
};

export type SavedFile = { readonly path: string; readonly sha256: string; readonly size: number };

export type OutboxPort = { readonly save: (name: string, bytes: Uint8Array) => Promise<SavedFile> };

export type Deps = {
  readonly portal: PortalPort;
  readonly session: SessionPort;
  readonly login: LoginPort;
  readonly credentials: CredentialSource;
  readonly outbox: OutboxPort;
  readonly claimsOf: (accessToken: string) => Claims;
  readonly now: Clock;
  readonly random: (bytes: number) => Uint8Array;
  /** Where the deployment says the ROeID leg is run end to end, when it has such a command. */
  readonly loginScript: string | undefined;
};
