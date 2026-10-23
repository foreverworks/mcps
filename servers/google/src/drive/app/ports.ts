/**
 * What the use cases need, named as OPERATIONS rather than endpoints. No URL,
 * query grammar or field list appears above infra/, which is the rule this port
 * exists to keep.
 */
import type { InputFiles } from "@foreverworks/mcp-kit";

import type { RawFile } from "../domain/entries.js";
import type { RawComment, RawPermission, RawReply, RawRevision } from "../domain/schema.js";

export type ListOptions = {
  readonly includeTrashed: boolean;
  readonly limit: number;
};

export type SearchSpec = {
  /** Substring of the name. Drive's `contains` is a prefix-ish match, not a regex. */
  readonly nameContains?: string;
  readonly fullText?: string;
  readonly mimeType?: string;
  readonly parentId?: string;
  /** RFC 3339. Drive compares instants, so a bare date means midnight UTC. */
  readonly modifiedAfter?: string;
  readonly includeTrashed: boolean;
  readonly limit: number;
};

export type Patch = {
  readonly name?: string;
  readonly addParents?: readonly string[];
  readonly removeParents?: readonly string[];
  readonly trashed?: boolean;
};

/** Bytes to store, as Drive is told about them. */
export type Upload = {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  /** RFC 3339: the source's own modification time, so Drive and the mirror agree on it. Drive's clock when absent. */
  readonly modifiedTime?: string;
  /** A Google type (a Doc, a Sheet, a deck) for Drive to convert the bytes into; they are kept as they are when absent. */
  readonly convertTo?: string;
};

export type ChangeBatch = {
  readonly changes: readonly { readonly fileId: string; readonly removed: boolean; readonly file?: RawFile }[];
  readonly nextPageToken?: string;
  readonly newStartPageToken?: string;
};

export type About = {
  readonly user: string;
  readonly quotaUsedBytes: number | null;
  readonly quotaLimitBytes: number | null;
};

/** A new comment: its text, and what it is about when the file type lets it say. */
export type NewComment = {
  readonly content: string;
  /** The text the comment is about, shown quoted beside it. */
  readonly quoted?: string;
  /** Drive's anchor JSON, for the file types whose viewers read one (not Google Docs, which shows API comments unanchored). */
  readonly anchor?: string;
};

/** Who gets access, and how much: Drive's permission resource as sent. */
export type NewPermission = {
  readonly type: "user" | "group" | "domain" | "anyone";
  readonly role: string;
  readonly emailAddress?: string;
  readonly domain?: string;
  readonly allowFileDiscovery?: boolean;
  /** RFC 3339. */
  readonly expirationTime?: string;
};

export type ShareOptions = {
  /** Drive's own email to the person or group; Drive's default is to send one. */
  readonly notify: boolean;
  readonly message?: string;
  /** Required by Drive to make someone the owner. */
  readonly transferOwnership?: boolean;
};

export type RevisionPatch = {
  readonly keepForever?: boolean;
  readonly published?: boolean;
  readonly publishAuto?: boolean;
  readonly publishedOutsideDomain?: boolean;
};

export type DrivePort = {
  readonly about: () => Promise<About>;
  readonly get: (id: string) => Promise<RawFile>;
  readonly listChildren: (parentId: string, options: ListOptions) => Promise<readonly RawFile[]>;
  readonly childrenNamed: (parentId: string, name: string) => Promise<readonly RawFile[]>;
  readonly search: (spec: SearchSpec) => Promise<readonly RawFile[]>;
  /** A new, empty file of one of Google's own types (a folder, a Doc, a Sheet) inside `parentId`. */
  readonly createFile: (name: string, mimeType: string, parentId: string) => Promise<RawFile>;
  /** A copy of `id` named `name` inside `parentId`: how a deck is made from a template. */
  readonly copy: (id: string, name: string, parentId: string) => Promise<RawFile>;
  readonly update: (id: string, patch: Patch) => Promise<RawFile>;
  /** A new file with these bytes inside `parentId`. Never retried: a second attempt could make a second file. */
  readonly upload: (parentId: string, file: Upload) => Promise<RawFile>;
  /** New bytes for an existing file: a new revision under the same id; Drive keeps the old one. */
  readonly replaceContent: (id: string, file: Upload) => Promise<RawFile>;
  /** Remove one revision of a file with bytes: how a damaged replacement is taken back. Not the file's only one. */
  readonly deleteRevision: (id: string, revisionId: string) => Promise<void>;
  readonly exportText: (id: string, exportMime: string) => Promise<string>;
  /** A file's own bytes, as Drive stores them. */
  readonly download: (id: string) => Promise<Uint8Array>;
  /** A native file (a Doc, a Sheet) rendered in another format: it has no bytes of its own. */
  readonly exportBytes: (id: string, exportMime: string) => Promise<Uint8Array>;
  readonly listComments: (fileId: string, options: { readonly includeDeleted: boolean; readonly modifiedAfter?: string; readonly limit: number }) => Promise<readonly RawComment[]>;
  /** Never retried: a second attempt could post the comment twice. */
  readonly createComment: (fileId: string, comment: NewComment) => Promise<RawComment>;
  readonly updateComment: (fileId: string, commentId: string, content: string) => Promise<RawComment>;
  readonly deleteComment: (fileId: string, commentId: string) => Promise<void>;
  /** A reply, a resolve or a reopen (`action`), or both. Never retried. */
  readonly createReply: (fileId: string, commentId: string, reply: { readonly content?: string; readonly action?: "resolve" | "reopen" }) => Promise<RawReply>;
  readonly updateReply: (fileId: string, commentId: string, replyId: string, content: string) => Promise<RawReply>;
  readonly deleteReply: (fileId: string, commentId: string, replyId: string) => Promise<void>;
  readonly listPermissions: (fileId: string) => Promise<readonly RawPermission[]>;
  /** Never retried: a second attempt could send a second invitation. */
  readonly createPermission: (fileId: string, permission: NewPermission, options: ShareOptions) => Promise<RawPermission>;
  readonly updatePermission: (
    fileId: string,
    permissionId: string,
    patch: { readonly role?: string; readonly expirationTime?: string; readonly removeExpiration?: boolean; readonly transferOwnership?: boolean },
  ) => Promise<RawPermission>;
  readonly deletePermission: (fileId: string, permissionId: string) => Promise<void>;
  readonly listRevisions: (fileId: string) => Promise<readonly RawRevision[]>;
  readonly updateRevision: (fileId: string, revisionId: string, patch: RevisionPatch) => Promise<RawRevision>;
  /** One revision's own bytes: files with bytes only. */
  readonly downloadRevision: (fileId: string, revisionId: string) => Promise<Uint8Array>;
  /** A Google file's revision rendered in another format, from the export link Drive lists for it. */
  readonly exportRevision: (exportLink: string) => Promise<Uint8Array>;
  readonly startPageToken: () => Promise<string>;
  readonly changes: (pageToken: string, limit: number) => Promise<ChangeBatch>;
};

/** The non-secret half of the configuration, for the tools that report on it. */
export type Grant = {
  /** Which credential the server is using, named, never its contents. */
  readonly source: string;
  readonly detail: string;
};

/** Where a download lands: a folder the caller can read (DRIVE_DOWNLOADS_DIR). */
export type Downloads = {
  readonly dir: string;
  /** Whole or not at all; returns the path written. */
  readonly save: (dir: string, name: string, bytes: Uint8Array) => Promise<string>;
};

export type Deps = {
  readonly drive: DrivePort;
  readonly grant: () => Grant;
  /** Files coming in to upload, read byte-exact by mcp-kit from this process's roots (MCP_FILE_ROOTS, and the mirror when there is one). */
  readonly readInput: InputFiles;
  /**
   * A local copy of My Drive (DRIVE_MIRROR_ROOT), when this process can read
   * one: a file uploaded from there goes to the folder it mirrors.
   */
  readonly mirror?: string;
  /** Absent where nothing may be written (Docs, Sheets and Slides reuse these deps): download_file then says so. */
  readonly downloads?: Downloads;
};
