/**
 * What the use cases need, stated as functions rather than objects with
 * behaviour. Everything here is an interface the infra layer satisfies; nothing
 * in app/ or domain/ ever imports from infra/.
 */
import type { InputFiles } from "@foreverworks/mcp-kit";

import type { PendingAuthorization } from "../domain/authorization.js";
import type { DeclarationReading } from "../domain/etransportFiling.js";
import type { InvoiceViewReading } from "../domain/invoiceView.js";
import type { InvoiceReading } from "../domain/invoiceXml.js";
import type {
  ConversionRefusal,
  DownloadRefusal,
  RawCompanyList,
  RawEtransportList,
  RawTransportStatus,
  RawTransportUpload,
  SealAnswer,
  RawMessageList,
  RawPagedMessageList,
  StatusHeader,
  UploadHeader,
  ValidationAnswer,
} from "../domain/schema.js";
import type { Issued, TokenBundle } from "../domain/tokens.js";
import type { Standard, UploadFlags } from "../domain/upload.js";
import type { LedgerEntry } from "../domain/uploadLedger.js";
import type { ValidationStandard } from "../domain/validation.js";
import type { Filter } from "../domain/window.js";

export type ListQuery = { readonly cif: string; readonly zile: number; readonly test: boolean };

export type WindowQuery = {
  readonly cif: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly pagina: number;
  readonly filtru?: Filter | undefined;
  readonly test: boolean;
};

export type UploadQuery = {
  readonly cif: string;
  readonly xml: Buffer;
  readonly standard: Standard;
  readonly flags: UploadFlags;
  readonly test: boolean;
  /** /uploadb2c, for an invoice to a person, instead of /upload. */
  readonly b2c: boolean;
};

/** An e-Transport declaration to file, by the CIF filing it. */
export type TransportQuery = { readonly cif: string; readonly xml: Buffer; readonly test: boolean };

/** An XML answer, typed, with the document it was read from. */
export type Receipt<H> = { readonly header: H; readonly raw: string };

/**
 * `/descarcare` answers HTTP 200 either way: the ZIP, or a JSON refusal. The
 * adapter reads the refusal when the bytes are not an archive; the use case
 * decides what that means.
 */
export type DownloadAnswer = { readonly bytes: Buffer; readonly refusal: DownloadRefusal | undefined };

/** /transformare's two answers, both HTTP 200: the PDF, or why not. */
export type Conversion = { readonly pdf: Buffer } | { readonly refusal: ConversionRefusal };

/** One file inside a downloaded archive. */
export type ArchiveEntry = { readonly name: string; readonly data: Buffer };

/** The certificate a seal was made with, as its own fields say. */
export type SealCertificate = {
  readonly subject: string;
  readonly organizationIdentifier?: string;
  readonly issuer: string;
  readonly serialNumber: string;
  readonly validFrom: string;
  readonly validTo: string;
};

/**
 * The seal checked here (infra/seal.ts). `valid` and `invalid` are final;
 * `inconclusive` means this code could not prove either, and ANAF is asked.
 */
export type LocalSealCheck =
  | { readonly verdict: "valid"; readonly certificate: SealCertificate }
  | { readonly verdict: "invalid"; readonly reason: string; readonly certificate: SealCertificate }
  | { readonly verdict: "inconclusive"; readonly reason: string; readonly certificate?: SealCertificate };

/**
 * The ANAF side of the world, in ANAF's own shapes (domain/schema.ts), parsed
 * and validated. Mapping them into this server's models is a pure function the
 * use cases apply afterwards, where it can be tested without a network.
 */
export type AnafPort = {
  /**
   * TestOauth's greeting, its first line at most. The endpoint echoes the
   * request's headers, bearer token included, so the rest never leaves the adapter.
   */
  readonly hello: (name: string) => Promise<string>;
  readonly listMessages: (q: ListQuery) => Promise<RawMessageList>;
  readonly listMessagesPaginated: (q: WindowQuery) => Promise<RawPagedMessageList>;
  readonly downloadMessage: (id: string, test: boolean) => Promise<DownloadAnswer>;
  readonly uploadInvoice: (q: UploadQuery) => Promise<Receipt<UploadHeader>>;
  readonly uploadStatus: (idIncarcare: string, test: boolean) => Promise<Receipt<StatusHeader>>;
  readonly etransportList: (q: ListQuery) => Promise<RawEtransportList>;
  /** Files an e-Transport declaration (v2). Never resent: an answer that is lost is OUTCOME_UNKNOWN. */
  readonly fileTransport: (q: TransportQuery) => Promise<RawTransportUpload>;
  readonly transportStatus: (idIncarcare: string, test: boolean) => Promise<RawTransportStatus>;
  /** ANAF's own validation of a UBL document. Public: no grant needed. */
  readonly validate: (xml: string, standard: ValidationStandard) => Promise<ValidationAnswer>;
  /** ANAF's PDF of a UBL document, validated first unless `validate` is false. Public: no grant needed. */
  readonly convert: (xml: string, standard: ValidationStandard, validate: boolean) => Promise<Conversion>;
  /** The VAT registry (PlatitorTvaRest), as of a YYYY-MM-DD date. Public: no grant needed. */
  readonly companies: (cifs: readonly string[], asOf: string) => Promise<RawCompanyList>;
  /** ANAF's own check of its seal on an invoice. Public: no grant needed. */
  readonly verifySeal: (invoice: Buffer, seal: Buffer) => Promise<SealAnswer>;
};

/**
 * The persisted OAuth pair.
 *
 * `rotate` is separate from a plain read because it WRITES: a refresh returns
 * a new refresh token to replace the old one, so the call that mints is also
 * the call that can lose the grant if two callers race it. `replace` stores a
 * pair minted by a new authorization, under the same lock.
 */
export type TokensPort = {
  readonly read: () => Promise<TokenBundle>;
  readonly rotate: () => Promise<TokenBundle>;
  readonly replace: (bundle: TokenBundle) => Promise<void>;
};

/** The authorization-code flow, as far as a use case needs to see it. */
export type AuthorizationPort = {
  /** app.json's registered redirect URIs, in order. */
  readonly redirectUris: () => Promise<readonly string[]>;
  readonly authorizeUrl: (redirectUri: string, state: string) => Promise<string>;
  /** One attempt: an authorization code is single-use. */
  readonly exchangeCode: (code: string, redirectUri: string) => Promise<Issued>;
  /** `code` and `state` out of the address the browser landed on. */
  readonly fromRedirect: (address: string) => { readonly code: string | undefined; readonly state: string | undefined };
  readonly newState: () => string;
  readonly pending: {
    readonly read: () => Promise<PendingAuthorization | undefined>;
    readonly write: (pending: PendingAuthorization) => Promise<void>;
    readonly clear: () => Promise<void>;
  };
};

/** Production uploads by the SHA-256 of their bytes (domain/uploadLedger.ts). */
export type UploadLedgerPort = {
  readonly find: (sha256: string) => Promise<LedgerEntry | undefined>;
  /**
   * Claims the bytes for a send, as one step under the ledger's lock: the earlier
   * entry is read and judged (domain/uploadLedger.ts, refileProblem) and, if it
   * allows, `sent` is written before the lock is released. Two calls with the
   * same bytes cannot both pass; the second sees the first's `sent`.
   */
  readonly reserve: (entry: Omit<LedgerEntry, "outcome">, refile: boolean) => Promise<Reservation>;
  /** Sets the entry for `entry.sha256`, replacing any earlier one. */
  readonly record: (entry: LedgerEntry) => Promise<void>;
};

export type Reservation = { readonly ok: true } | { readonly ok: false; readonly problem: string };

export type FilePort = {
  readonly writeFile: (dir: string, name: string, bytes: Buffer) => Promise<string>;
  /** A file the use case has already confined to the outbox. */
  readonly readFile: (path: string) => Promise<Buffer>;
  /**
   * A file the caller names by path in the server's file roots (the inbox),
   * read byte-exact by mcp-kit's reader, which also says where those roots are
   * in the words the tool descriptions use.
   */
  readonly readInput: InputFiles;
};

export type Paths = {
  /** app.json; undefined when ANAF_CONFIG is not set. */
  readonly config: string | undefined;
  readonly tokens: string;
  readonly stateDir: string;
  /** The outbox: every download lands here or in a folder under it (the caller's save_dir). */
  readonly downloadsDir: string;
  /** Set when the layout would write beside app.json: every tool that reads app.json or writes a file fails with it. */
  readonly layoutProblem?: string;
};

/** The non-secret half of app.json, for the tools that report on configuration. */
export type AppIdentity = {
  readonly appName: string;
  /** Last four characters only. The whole client_id is a credential's other half. */
  readonly clientIdLast4: string;
  /** The CIF every tool defaults to, when app.json names one. */
  readonly defaultCif?: string | undefined;
};

export type Clock = () => number;

export type Deps = {
  readonly anaf: AnafPort;
  readonly tokens: TokensPort;
  readonly authorization: AuthorizationPort;
  readonly files: FilePort;
  readonly uploads: UploadLedgerPort;
  readonly paths: Paths;
  readonly identity: () => Promise<AppIdentity>;
  /** What an invoice XML says about itself; the same reading the confirmation summary uses. */
  readonly readInvoice: (xml: string) => InvoiceReading;
  /** What an e-Transport declaration does, read from its XML; the same reading its confirmation line uses. */
  readonly readDeclaration: (xml: string) => DeclarationReading;
  /** A UBL document as plain JSON, every value as written (parse_invoice). */
  readonly viewInvoice: (xml: string) => InvoiceViewReading;
  /** The files in a ZIP, each checked against its CRC; fails on a corrupt archive. */
  readonly unzip: (bytes: Buffer) => readonly ArchiveEntry[];
  /** ANAF's seal on an invoice, checked here (infra/seal.ts); `nowEpoch` in seconds. */
  readonly checkSeal: (
    invoice: Buffer,
    seal: Buffer,
    context: { readonly nowEpoch: number; readonly issuedOn?: string | undefined },
  ) => LocalSealCheck;
  /** Seconds since the epoch. A port because every token rule is a comparison against it. */
  readonly now: Clock;
};
