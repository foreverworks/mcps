/**
 * What the use cases need, stated as functions rather than objects with
 * behaviour. Everything here is an interface the infra layer satisfies; nothing
 * in app/ or domain/ ever imports from infra/.
 */
import type { HtmlToText } from "../domain/body.js";
import type { GrantRole } from "../domain/grants.js";
import type { Label } from "../domain/labels.js";
import type { RawMessage, RawThread } from "../domain/summaries.js";
import type { FilterSpec } from "../domain/filters.js";
import type { DraftListPage, FilterList, HistoryPage, Profile, RawDraft, RawFilter, SendAs, ThreadListPage } from "../domain/schema.js";
import type { TokenInfo } from "../../domain/tokenInfo.js";
import type { FileSource, InputFile } from "@foreverworks/mcp-kit";

export type { DraftListPage, FilterList, FilterSpec, HistoryPage, Profile, RawDraft, RawFilter, SendAs, ThreadListPage };




export type { TokenInfo };

/** `reason` is Google's reason, `http_<status>`, or the failure's kind ("quota" when Gmail throttled it past every retry). */
export type Fetched<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };




export type LabelChange = { readonly add: readonly string[]; readonly remove: readonly string[] };

export type LabelSpec = {
  readonly name?: string;
  readonly labelListVisibility?: string;
  readonly messageListVisibility?: string;
  readonly color?: { readonly backgroundColor: string; readonly textColor: string };
};

export type GmailPort = {
  readonly profile: () => Promise<Profile>;
  readonly tokenInfo: () => Promise<TokenInfo>;
  readonly labels: () => Promise<{ readonly labels?: readonly Label[] }>;
  /** Readable on gmail.modify (and gmail.readonly); only creating or deleting one needs gmail.settings.basic. */
  readonly filters: () => Promise<FilterList>;
  readonly listThreads: (q: { query?: string; maxResults: number; pageToken?: string }) => Promise<ThreadListPage>;
  readonly getThread: (id: string, o: { format: string; metadataHeaders?: readonly string[] }) => Promise<RawThread>;
  /** Many at once. A per-item failure is REPORTED, never thrown: one unreadable
   *  thread must not lose the whole result set. */
  readonly getThreads: (
    ids: readonly string[],
    o: { format: string; metadataHeaders?: readonly string[]; concurrency?: number },
  ) => Promise<readonly Fetched<RawThread>[]>;
  readonly getMessage: (id: string, o: { format: string; metadataHeaders?: readonly string[] }) => Promise<RawMessage>;
  /** Many at once, in the order asked; a per-item failure is reported like getThreads'. */
  readonly getMessages: (
    ids: readonly string[],
    o: { format: string; metadataHeaders?: readonly string[]; concurrency?: number },
  ) => Promise<readonly Fetched<RawMessage>[]>;
  readonly getAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>;
  readonly listHistory: (q: { startHistoryId: string; maxResults: number; pageToken?: string }) => Promise<HistoryPage>;
};

/**
 * The writes. A separate port because a separate GRANT stands behind it: an
 * account can read on a grant that cannot write, and the use cases check that
 * before they call anything here.
 *
 * `raw` is a whole RFC 5322 message; the adapter decides how it travels.
 */
export type GmailWritePort = {
  readonly sendAs: () => Promise<{ readonly sendAs?: readonly SendAs[] }>;
  readonly createDraft: (raw: string, threadId?: string) => Promise<RawDraft>;
  readonly updateDraft: (id: string, raw: string, threadId?: string) => Promise<RawDraft>;
  readonly getDraft: (id: string, format: string) => Promise<RawDraft>;
  readonly listDrafts: (q: { query?: string; maxResults: number; pageToken?: string }) => Promise<DraftListPage>;
  readonly deleteDraft: (id: string) => Promise<void>;
  readonly sendDraft: (id: string) => Promise<RawMessage>;
  readonly sendMessage: (raw: string, threadId?: string) => Promise<RawMessage>;
  readonly modifyMessages: (ids: readonly string[], change: LabelChange) => Promise<void>;
  readonly modifyThread: (id: string, change: LabelChange) => Promise<RawThread>;
  readonly trash: (target: "message" | "thread", id: string) => Promise<unknown>;
  readonly untrash: (target: "message" | "thread", id: string) => Promise<unknown>;
  readonly createLabel: (spec: LabelSpec) => Promise<Label>;
  readonly updateLabel: (id: string, spec: LabelSpec) => Promise<Label>;
  readonly deleteLabel: (id: string) => Promise<void>;
  readonly createFilter: (spec: FilterSpec) => Promise<RawFilter>;
  readonly deleteFilter: (id: string) => Promise<void>;
};

export type FilePort = {
  /** Saves whole, never over a different file (a taken name gets " (2)"); returns the path the bytes are at. */
  readonly writeFile: (dir: string, name: string, bytes: Buffer) => Promise<string>;
  /** A file to attach, byte-exact: by path inside the server's roots, or base64 checked against its sha256 (mcp-kit). */
  readonly readInput: (source: FileSource) => Promise<InputFile>;
};

/** What credentials.json CLAIMS. The grant check diffs this against the issuer. */
export type GrantDeclaration = {
  readonly clientId: string;
  readonly scopes: readonly string[];
};

/**
 * One credential file and what reaches Google through it. An account has one
 * or two of these; `Deps.grant` is the one its tools use.
 */
export type GrantHandle = {
  readonly role: GrantRole;
  readonly credentials: string;
  /** What the issuer granted, as recorded when the access token was minted. */
  readonly scopes: () => Promise<readonly string[]>;
  readonly declaration: () => Promise<GrantDeclaration>;
  readonly tokenInfo: () => Promise<TokenInfo>;
  readonly profile: () => Promise<Profile>;
};

export type Paths = {
  readonly stateDir: string;
  readonly attachmentsDir: string;
};

export type Deps = {
  /** Which registered mailbox this bundle talks to. Tagged onto every result
   *  that can cross accounts, so a thread id is never ambiguous. */
  readonly account: string;
  /** The address the registry says this account is, when it says. */
  readonly address?: string;
  readonly gmail: GmailPort;
  readonly write: GmailWritePort;
  /** The grant this account's tools run on: its own modify grant when that
   *  file exists, else its read-only one. */
  readonly grant: GrantHandle;
  /** Every grant configured for the account, the unused one included, so
   *  health can report on both. */
  readonly grants: readonly GrantHandle[];
  /** A path configured for a modify grant, whether or not the file exists. */
  readonly modifyPath?: string;
  readonly files: FilePort;
  readonly htmlToText: HtmlToText;
  /** The IANA zone a quote's "On <date> ... wrote:" is written in: its readers'. */
  readonly timeZone: string;
  readonly paths: Paths;
  /** MIME multipart boundaries. Injected so the builder stays pure. */
  readonly boundary: () => string;
};
