/**
 * Notion's wire shapes, as Notion itself types them in @notionhq/client
 * (pinned exactly in package.json) rather than copied here. Type-only: nothing
 * of that package runs, and its runtime would default to an older API version
 * than the one this server pins (infra/http.ts). The one import in domain/, on
 * purpose.
 *
 * The package types both API versions and marks the pre-2026-03-11 fields
 * deprecated (`archived`, `after`); nothing here reads them. `Wire` (the kit's)
 * makes every optional field possibly `null` too, as answers really arrive.
 */
import type { Wire } from "@foreverworks/mcp-kit";
import type {
  BlockObjectResponse,
  CommentObjectResponse,
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  FileUploadObjectResponse,
  GetBlockResponse,
  GetViewQueryResultsResponse,
  GetViewResponse,
  ListBlockChildrenResponse,
  ListCommentsResponse,
  ListDatabaseViewsResponse,
  ListUsersResponse,
  PageObjectResponse,
  PropertyItemListResponse,
  PropertyItemObjectResponse,
  QueryDataSourceResponse,
  RichTextItemResponse,
  SearchResponse,
  UserObjectResponse,
  ViewQueryResponse,
} from "@notionhq/client";
import type { ListDataSourceTemplatesResponse } from "@notionhq/client/build/src/api-endpoints/data-sources.js";
import type { PageMarkdownResponse } from "@notionhq/client/build/src/api-endpoints/common.js";

export type RawPage = Wire<PageObjectResponse>;
/** One value in a page's `properties`, discriminated by `type`. (`Wire` lets a map's value be null; one that is, is skipped.) */
export type RawPropertyValue = NonNullable<RawPage["properties"][string]>;
export type RawParent = RawPage["parent"];

export type RawDatabase = Wire<DatabaseObjectResponse>;
export type RawDataSource = Wire<DataSourceObjectResponse>;
/** One column of a data source, discriminated by `type`. */
export type RawColumn = NonNullable<RawDataSource["properties"][string]>;

export type RawRichText = Wire<RichTextItemResponse>;
export type RawUser = Wire<UserObjectResponse>;
export type RawComment = Wire<CommentObjectResponse>;
export type RawMarkdown = Wire<PageMarkdownResponse>;

/** A block, discriminated by `type`. A page is a block too (`child_page`), and so is a database (`child_database`). */
export type RawBlock = Wire<BlockObjectResponse>;
/** `GET /v1/blocks/{id}`: the block, or a partial one that carries only its id. */
export type RawBlockAnswer = Wire<GetBlockResponse>;
/** `GET /v1/blocks/{id}/children`: one page of the blocks directly inside it, partial ones among them. */
export type RawBlockChildren = Wire<ListBlockChildrenResponse>;

export type RawSearch = Wire<SearchResponse>;
export type RawSearchHit = RawSearch["results"][number];
export type RawQuery = Wire<QueryDataSourceResponse>;
export type RawQueryResult = RawQuery["results"][number];
export type RawComments = Wire<ListCommentsResponse>;

/** `GET /v1/pages/{id}/properties/{property_id}` for a paginated property: relation, people, title, rich_text. */
export type RawPropertyItems = Wire<PropertyItemListResponse>;
export type RawPropertyItem = Wire<PropertyItemObjectResponse>;

export type RawTemplates = Wire<ListDataSourceTemplatesResponse>;

/** `GET /v1/views?database_id=`: references only (`{object, id}`), so each view is read on its own. */
export type RawViewList = Wire<ListDatabaseViewsResponse>;
/** `GET /v1/views/{id}`: a view's name, type, data source, filter and sorts, or a partial one with its id and type. */
export type RawView = Wire<GetViewResponse>;
/** `POST /v1/views/{id}/queries`: the first page of a cached query (page references), its id and the total. */
export type RawViewQuery = Wire<ViewQueryResponse>;
/** `GET /v1/views/{id}/queries/{query_id}`: a later page of the same cached query. */
export type RawViewQueryPage = Wire<GetViewQueryResultsResponse>;

/** `GET /v1/users`: one page of a workspace's people and bots. */
export type RawUserList = Wire<ListUsersResponse>;

/** `POST /v1/file_uploads` and its `/send`: an upload's id and status (`pending`, then `uploaded`). */
export type RawFileUpload = Wire<FileUploadObjectResponse>;
