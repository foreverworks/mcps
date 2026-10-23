/**
 * What the use cases need, named as OPERATIONS rather than endpoints. Reads
 * answer with Notion's own objects (typed in domain/schema.ts); writes take the
 * domain's checked changes. No URL, header or body shape appears above infra/.
 */
import type { InputFiles } from "@foreverworks/mcp-kit";

import type { ContentEdit } from "../domain/content.js";
import type { Writes } from "../domain/properties/write.js";
import type { QueryPlan } from "../domain/query.js";
import type { FileBlockType } from "../domain/files.js";
import type { ColumnSpec, NewDatabase, OptionsChange } from "../domain/schemaEdits.js";
import type { TemplateChoice } from "../domain/templates.js";
import type {
  RawTemplates,
  RawBlockAnswer,
  RawBlockChildren,
  RawComment,
  RawComments,
  RawDatabase,
  RawDataSource,
  RawFileUpload,
  RawMarkdown,
  RawPage,
  RawPropertyItems,
  RawQuery,
  RawSearch,
  RawUser,
  RawUserList,
  RawView,
  RawViewList,
  RawViewQuery,
  RawViewQueryPage,
} from "../domain/schema.js";
import type { User } from "../domain/users.js";
import type { Locator } from "./locate.js";

export type SearchSpec = {
  /** Matched against titles; absent lists everything the integration can see, newest edit first. */
  readonly query?: string;
  readonly kind?: "page" | "database";
  readonly pageSize: number;
  readonly cursor?: string;
};

/** Where a page goes: a row in a data source, or a child of a page. */
export type NewParent = { readonly type: "data_source"; readonly id: string } | { readonly type: "page"; readonly id: string };

/** Where a NEW page may also go: the top level of the workspace, private to the token's user. */
export type NewPageParent = NewParent | { readonly type: "workspace" };

export type NewPage = {
  readonly parent: NewPageParent;
  readonly properties: Writes;
  readonly markdown?: string;
  /** An emoji. */
  readonly icon?: string;
  /** A template Notion fills the page from, after it is made. */
  readonly template?: TemplateChoice;
};

export type PagePatch = {
  readonly properties?: Writes;
  readonly inTrash?: boolean;
  /** An emoji, or null to remove the icon. */
  readonly icon?: string | null;
  readonly locked?: boolean;
};

/** Every call on one workspace, through that workspace's integration token. */
export type NotionPort = {
  /** The integration's bot user: its name and its workspace. */
  readonly me: () => Promise<RawUser>;
  /** One page of the workspace's people and bots. */
  readonly listUsers: (pageSize: number, cursor?: string) => Promise<RawUserList>;
  readonly search: (spec: SearchSpec) => Promise<RawSearch>;
  readonly getPage: (id: string) => Promise<RawPage>;
  /** One page of a paginated property's items (a relation past its first 25 pages). */
  readonly getPropertyItems: (pageId: string, propertyId: string, cursor?: string) => Promise<RawPropertyItems>;
  readonly getMarkdown: (id: string, includeTranscript: boolean) => Promise<RawMarkdown>;
  /** One block, a page included (a page is a block). */
  readonly getBlock: (id: string) => Promise<RawBlockAnswer>;
  /** One page of the blocks directly inside a block or a page, in order. */
  readonly listBlockChildren: (id: string, pageSize: number, cursor?: string) => Promise<RawBlockChildren>;
  readonly getDatabase: (id: string) => Promise<RawDatabase>;
  readonly getDataSource: (id: string) => Promise<RawDataSource>;
  readonly listTemplates: (dataSourceId: string, pageSize: number, cursor?: string) => Promise<RawTemplates>;
  /** A new column on a data source; answers the data source as it is after. */
  readonly addColumn: (dataSourceId: string, spec: ColumnSpec) => Promise<RawDataSource>;
  /** A column's option list, sent back whole with the new options; answers the data source as it is after. */
  readonly setOptions: (dataSourceId: string, change: OptionsChange) => Promise<RawDataSource>;
  readonly createDatabase: (db: NewDatabase) => Promise<RawDatabase>;
  /** One page of a database's saved views, as references (ids). */
  readonly listViews: (databaseId: string, pageSize: number, cursor?: string) => Promise<RawViewList>;
  readonly getView: (id: string) => Promise<RawView>;
  /** Runs a view's saved filter and sorts; Notion keeps the result about 15 minutes, read on by `viewQueryPage`. */
  readonly queryView: (viewId: string, pageSize: number) => Promise<RawViewQuery>;
  readonly viewQueryPage: (viewId: string, queryId: string, pageSize: number, cursor: string) => Promise<RawViewQueryPage>;
  readonly query: (dataSourceId: string, plan: QueryPlan) => Promise<RawQuery>;
  readonly createPage: (page: NewPage) => Promise<RawPage>;
  readonly updatePage: (id: string, patch: PagePatch) => Promise<RawPage>;
  readonly movePage: (id: string, to: NewParent) => Promise<RawPage>;
  readonly editContent: (id: string, edit: ContentEdit) => Promise<RawMarkdown>;
  /** A new upload Notion waits for the bytes of (and forgets within an hour if nothing attaches it). */
  readonly createFileUpload: (filename: string, contentType: string) => Promise<RawFileUpload>;
  /** The bytes of an upload, in one request (at most 20 MiB). */
  readonly sendFileUpload: (id: string, filename: string, contentType: string, bytes: Uint8Array) => Promise<RawFileUpload>;
  /** A block holding an uploaded file, added at the end of a page's body. */
  readonly appendFileBlock: (pageId: string, type: FileBlockType, uploadId: string) => Promise<RawBlockChildren>;
  readonly listComments: (pageId: string, pageSize: number, cursor?: string) => Promise<RawComments>;
  /** On a page, starting a discussion, or as a reply in one. */
  readonly addComment: (target: { readonly pageId: string } | { readonly discussionId: string }, markdown: string) => Promise<RawComment>;
};

export type Accounts = {
  /** The workspace labels, from the token files. A missing directory is a config failure. */
  readonly labels: () => Promise<readonly string[]>;
  /** The port for one label; built once per label, so its pacing is shared by every caller. */
  readonly api: (label: string) => NotionPort;
  /** Where the token files are read from, for list_accounts; undefined when nothing names a directory. */
  readonly source: string | undefined;
};

export type Deps = {
  readonly accounts: Accounts;
  readonly locator: Locator;
  /** A data source's schema, remembered for a minute: a column just added shows up within one. */
  readonly schema: (account: string, dataSourceId: string) => Promise<RawDataSource>;
  /** A workspace's people and bots, every page of them, remembered for five minutes. */
  readonly users: (account: string) => Promise<readonly User[]>;
  /** The kit's input-file reader: a file to upload, by path, never as text a model typed. */
  readonly readInput: InputFiles;
  /** Where downloaded files are saved (NOTION_OUTBOX_DIR); undefined when nobody set one. */
  readonly outbox: string | undefined;
  /** A Notion-hosted file's bytes, from its signed link, without the workspace's token. */
  readonly download: (url: string) => Promise<Uint8Array>;
};
