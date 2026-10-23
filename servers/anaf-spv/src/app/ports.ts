/**
 * What the use cases need, as functions. Everything here is an interface the
 * infra layer satisfies; nothing in app/ or domain/ imports from infra/.
 */
import type { InputFiles } from "@foreverworks/mcp-kit";

import type { ContactForm, ContactRegistered } from "../domain/contact.js";
import type { FormName, KitSource } from "../domain/declarations.js";
import type { MessageRow } from "../domain/messages.js";
import type { CuiOnly, RequestFields } from "../domain/requests.js";
import type { Cookies, PendingLogin, Session } from "../domain/session.js";

/** Milliseconds since the epoch. */
export type Clock = () => number;

export type Credentials = { readonly username: string; readonly password: string };

/** Where the credential comes from, for health: never the secret itself. */
export type CredentialInfo =
  | { readonly kind: "none"; readonly missing: string }
  | { readonly kind: "file" | "variable"; readonly username: string | undefined }
  | { readonly kind: "mcp"; readonly transport: "http" | "stdio"; readonly tool: string; readonly item: string };

/** The SPV user name and password, read when a sign-in needs them and never kept. */
export type CredentialSource = {
  readonly info: CredentialInfo;
  readonly read: () => Promise<Credentials>;
};

/** A watch on the mailbox, begun BEFORE the password is sent so an old code is never mistaken for the new one. */
export type CodeWatch = {
  /** The first code that was not there when the watch began, or `undefined` when none came before `deadlineMs`. */
  readonly next: (deadlineMs: number) => Promise<string | undefined>;
  readonly close: () => Promise<void>;
};

export type CodeInfo =
  | { readonly driver: "manual"; readonly why: string }
  | { readonly driver: "google" | "text" | "auto"; readonly transport: "http" | "stdio"; readonly detail: string };

/** Where the e-mailed code is read from. `watch` answers `undefined` for a source that cannot read mail. */
export type CodeSource = {
  readonly info: CodeInfo;
  readonly watch: () => Promise<CodeWatch | undefined>;
};

export type PasswordOutcome =
  | { readonly kind: "code_requested"; readonly cookies: Cookies }
  | { readonly kind: "signed_in"; readonly cookies: Cookies }
  | { readonly kind: "refused"; readonly message: string };

export type CodeOutcome = { readonly kind: "signed_in"; readonly cookies: Cookies } | { readonly kind: "refused"; readonly message: string };

/** SPV's sign-in form, step by step. Each step answers the cookies it ended with. */
export type LoginPort = {
  /** A fresh F5 session at the sign-in form. */
  readonly begin: () => Promise<Cookies>;
  readonly submitPassword: (cookies: Cookies, credentials: Credentials) => Promise<PasswordOutcome>;
  readonly submitCode: (cookies: Cookies, code: string) => Promise<CodeOutcome>;
  /** Sign out at SPV, best effort. */
  readonly end: (cookies: Cookies) => Promise<void>;
};

/** A document as SPV served it; `fileName` is the name SPV gave it, unchanged. */
export type Downloaded = { readonly bytes: Uint8Array; readonly fileName: string; readonly contentType: string };

/**
 * One listing of the messages, and downloads from it. SPV's download links
 * are positions in the list the session last rendered, so a download goes
 * through the listing it came from, and only while that listing's operation
 * runs (PortalPort.withMessages).
 */
export type MessagesView = {
  readonly rows: readonly MessageRow[];
  /** The document of `rows[index]`. */
  readonly download: (index: number) => Promise<Downloaded>;
};

export type RequestForm = {
  /** The tax ids this account may request documents for; the first is the form's default. */
  readonly identities: readonly string[];
  /** The document types for a person (a 13-digit CNP) and for a company (any other id), as the form offers them. */
  readonly personTypes: readonly string[];
  readonly companyTypes: readonly string[];
};

export type Submitted = { readonly kind: "registered"; readonly requestId: string } | { readonly kind: "refused"; readonly message: string };

/** A message for SPV's contact form, every value already checked against the form (domain/contact.ts). */
export type ContactSubmission = {
  readonly cif: string;
  readonly category: string;
  readonly subcategory: string | undefined;
  readonly text: string;
  readonly attachment: { readonly name: string; readonly bytes: Uint8Array } | undefined;
};

export type ContactOutcome = { readonly kind: "registered"; readonly registered: ContactRegistered } | { readonly kind: "not_registered"; readonly message: string };

/**
 * The pages behind the session the store holds. Each reads the stored
 * cookies, writes back what SPV set, and throws `session_expired` when SPV
 * sends it to the sign-in form (or no session is stored), which the use cases
 * answer by signing in once and calling again.
 */
export type PortalPort = {
  readonly probe: () => Promise<void>;
  /**
   * List the messages and run `use` on the listing as ONE operation: nothing
   * else reaches the portal on this session until `use` settles, so no other
   * listing can shift the rows its downloads point at. Its downloads fail
   * once it has settled.
   */
  readonly withMessages: <T>(use: (view: MessagesView) => Promise<T>) => Promise<T>;
  readonly requestForm: () => Promise<RequestForm>;
  readonly submitRequest: (request: { readonly cif: string; readonly type: string; readonly fields: RequestFields }) => Promise<Submitted>;
  /** The contact form ("Formular de contact") as SPV renders it now. Reads only. */
  readonly contactForm: () => Promise<ContactForm>;
  /** Send a message through the contact form: it reaches ANAF, registered under the account's name. */
  readonly submitContact: (message: ContactSubmission) => Promise<ContactOutcome>;
};

/** A DUKIntegrator kit: which of ANAF's packages, and what it was built from. */
export type KitInfo = { readonly form: FormName; readonly zip: string; readonly builtAt: string; readonly files: readonly { readonly file: string; readonly source: string; readonly sha256: string }[] };

export type DukResult = {
  readonly valid: boolean;
  /** What the integrator printed. */
  readonly output: string;
  /** Its error file, verbatim (`ok` when valid). */
  readonly errors: string;
  readonly kit: KitInfo;
  /** The filing PDF, when asked for and the XML was valid. */
  readonly pdf?: Uint8Array;
  /** Why the PDF step made no file, in the integrator's words. */
  readonly pdfFailure?: string;
};

/** ANAF's DUKIntegrator with the form's own jars from one of ANAF's packages: validation, and the filing PDF. */
export type DukPort = {
  readonly run: (job: { readonly form: FormName; readonly kit: KitSource; readonly xml: Uint8Array; readonly pdf: boolean }) => Promise<DukResult>;
};

export type UploadOutcome = { readonly kind: "accepted"; readonly index: string } | { readonly kind: "refused"; readonly message: string };

/** formularespv-pf's upload page, behind its own session. */
export type FormsPort = {
  /** A fresh rendering of the upload page, then the file posted on it, as one operation. */
  readonly upload: (request: { readonly path: string; readonly fileName: string; readonly bytes: Uint8Array }) => Promise<UploadOutcome>;
};

/** A site this server signs in to with the SPV user name and password: its sign-in form and its stored session. */
export type Site = { readonly name: string; readonly login: LoginPort; readonly store: SessionStore };

/** A filing PDF this server made from a valid XML, and whether it was filed. By the PDF's SHA-256 (declarations.json). */
export type DeclarationEntry = {
  readonly form: FormName;
  readonly year: number;
  /** The period's month (12 for D212's reporting year); absent in entries made before monthly forms. */
  readonly month?: number;
  readonly cif: string | undefined;
  readonly xmlSha256: string;
  readonly pdfSha256: string;
  readonly pdfBytes: number;
  readonly pdfName: string;
  readonly validatedAtMs: number;
  readonly filed?: {
    readonly atMs: number;
    readonly outcome: "pending" | "accepted" | "refused";
    /** formularespv-pf's index de depunere. */
    readonly index?: string;
    /** The index de încărcare and registration number SPV's RECIPISA gave it: what ANAF's status service knows it by. */
    readonly uploadIndex?: string;
    readonly registration?: string;
  };
};

export type DeclarationLedgerPort = {
  readonly read: () => Promise<Readonly<Record<string, DeclarationEntry>>>;
  readonly record: (entry: DeclarationEntry) => Promise<void>;
};

/** One filing as ANAF's status service lists it, its cells as the page shows them. */
export type StareRow = {
  readonly index: string;
  /** "Tip document": the form (D212, D112, F4109, ...). */
  readonly document: string;
  /** "Stare document", ANAF's words. */
  readonly state: string;
  /** "Data inregistrare": the registration number and its date, "INTERNT-<index>-<year> din DD.MM.YYYY". */
  readonly registered: string;
  /** "Data incarcare", YYYY-MM-DD. */
  readonly uploaded: string;
  /** Whether the row links its receipt (ANAF keeps it 60 days after filing). */
  readonly receiptLinked: boolean;
};

export type StareAnswer =
  /** The tax id's filings of the window the page names (DD.MM.YYYY): the last three months, at most 200. */
  | { readonly kind: "rows"; readonly cif: string; readonly from: string; readonly to: string; readonly rows: readonly StareRow[] }
  /** No filing with that index for that tax id in the window. */
  | { readonly kind: "none" }
  /** The page refused the input, in its words. */
  | { readonly kind: "refused"; readonly message: string };

/** ANAF's public status service for filed declarations (StareD112): no sign-in. */
export type StarePort = {
  readonly lookup: (query: { readonly index: string; readonly cif: string }) => Promise<StareAnswer>;
  /** The receipt's signed PDF, or undefined once ANAF no longer serves it. */
  readonly receipt: (index: string) => Promise<Uint8Array | undefined>;
};

/** The state dir: the session and a sign-in waiting for its code. Files are 0600. */
export type SessionStore = {
  readonly read: () => Promise<Session | undefined>;
  readonly write: (session: Session) => Promise<void>;
  readonly clear: () => Promise<void>;
  readonly readPending: () => Promise<PendingLogin | undefined>;
  readonly writePending: (pending: PendingLogin) => Promise<void>;
  readonly clearPending: () => Promise<void>;
};

export type Saved = { readonly path: string; readonly present: boolean };

/** The outbox: downloads land here or in a folder under it. */
export type FilePort = {
  readonly root: string;
  /** Save whole or not at all; a name holding other bytes is never replaced (the file gets the next free numbered name). */
  readonly save: (dir: string, name: string, bytes: Uint8Array) => Promise<Saved>;
};

/** What sync_messages has already saved, by message key. */
export type SyncedEntry = { readonly path: string; readonly sha256: string; readonly savedAtMs: number };

export type LedgerPort = {
  readonly read: () => Promise<Readonly<Record<string, SyncedEntry>>>;
  readonly record: (entries: Readonly<Record<string, SyncedEntry>>) => Promise<void>;
};

/**
 * A contact form message this server sent or tried to send, by its
 * fingerprint (the identity, category, text and attachment). `pending` is a
 * post whose answer never came: it may have been registered.
 */
export type ContactEntry =
  | { readonly outcome: "pending"; readonly atMs: number }
  | { readonly outcome: "registered"; readonly atMs: number; readonly registrationNumber: string; readonly registeredOn: string }
  | { readonly outcome: "not_registered"; readonly atMs: number };

export type ContactLedgerPort = {
  readonly read: () => Promise<Readonly<Record<string, ContactEntry>>>;
  readonly record: (fingerprint: string, entry: ContactEntry) => Promise<void>;
};

/** One of SPV's alert e-mails, as text lines. */
export type AlertMail = { readonly id: string; readonly receivedAtMs: number; readonly lines: readonly string[] };

/** SPV's alert e-mails ("Documente noi SPV") in the mailbox, read through the mail MCP server; dates are Bucharest calendar dates. */
export type AlertsPort = {
  readonly read: (range: { readonly since: string | undefined; readonly until: string | undefined; readonly limit: number }) => Promise<{
    readonly mails: readonly AlertMail[];
    readonly more: boolean;
  }>;
};

/** The types SPV refused for a CNP as "only for a CUI", by folded type name (cui-only.json). */
export type CuiOnlyPort = {
  readonly read: () => Promise<Readonly<Record<string, CuiOnly>>>;
  readonly learn: (type: string, spvSaid: string) => Promise<void>;
};

export type Deps = {
  readonly login: LoginPort;
  readonly portal: PortalPort;
  readonly store: SessionStore;
  readonly credentials: CredentialSource;
  readonly codes: CodeSource;
  readonly alerts: AlertsPort;
  readonly files: FilePort;
  readonly ledger: LedgerPort;
  readonly contacts: ContactLedgerPort;
  readonly cuiOnly: CuiOnlyPort;
  readonly duk: DukPort;
  readonly declarations: DeclarationLedgerPort;
  /** ANAF's status service for filings, by index and tax id. */
  readonly stare: StarePort;
  /** formularespv-pf: its sign-in and session, and its upload page. */
  readonly forms: { readonly site: Site; readonly pages: FormsPort; readonly url: string };
  /** Files a tool takes by path, from the server's file roots (an inbox): never content in arguments. */
  readonly inputFiles: InputFiles;
  /** One sign-in at a time, across this process and any other on the same state dir. */
  readonly exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly sha256: (bytes: Uint8Array) => string;
  readonly now: Clock;
  readonly sleep: (ms: number) => Promise<void>;
  /** How long a sign-in waits for the code to show up in the mailbox. */
  readonly codeWaitMs: number;
  /** How often the mailbox and the message list are polled. */
  readonly pollMs: number;
  readonly portalUrl: string;
};
