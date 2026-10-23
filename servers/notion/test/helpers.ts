/**
 * Shared test plumbing. Every token directory is a fresh temp dir and every
 * request is answered by a stubbed fetch: the isolation setup refuses
 * anything else, and no default path exists that could lead to anyone's real
 * tokens.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inputFilesWith } from "@foreverworks/mcp-kit";
import { vi } from "vitest";

import { makeLocator } from "../src/app/locate.js";
import { readAllUsers } from "../src/app/usecases/users.js";
import type { Accounts, Deps, NotionPort } from "../src/app/ports.js";
import { asAppError, fail } from "../src/domain/errors.js";
import type { RawDatabase, RawDataSource, RawPage } from "../src/domain/schema.js";

export const tempDir = (prefix = "notion-test-"): string => mkdtempSync(join(tmpdir(), prefix));

/** A tokens directory holding `notion-<label>` for each entry. */
export const tokensDir = (tokens: Readonly<Record<string, string>>): string => {
  const dir = tempDir("notion-tokens-");
  for (const [label, token] of Object.entries(tokens)) writeFileSync(join(dir, `notion-${label}`), `${token}\n`);
  return dir;
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const notionError = (status: number, code: string, message = code): Response => json({ object: "error", status, code, message }, status);

export type FetchCall = { readonly url: string; readonly method: string; readonly body: unknown; readonly headers: Record<string, string> };

/** Stub fetch for one test; `calls` records what was asked, parsed. */
export const withFetch = (impl: (url: string, init?: RequestInit) => Promise<Response> | Response) => {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const raw = init?.body;
      const body = typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined;
      calls.push({ url, method: init?.method ?? "GET", body, headers: { ...(init?.headers as Record<string, string>) } });
      return impl(url, init);
    }),
  );
  return calls;
};

export const errorOf = async (run: () => unknown) => {
  try {
    await run();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown);
  }
};

// Fixtures: the least of each Notion object the code reads, typed through the wire types.

export const ID = {
  page: "11111111-1111-4111-8111-111111111111",
  row: "22222222-2222-4222-8222-222222222222",
  database: "33333333-3333-4333-8333-333333333333",
  source: "44444444-4444-4444-8444-444444444444",
  other: "55555555-5555-4555-8555-555555555555",
};

const text = (content: string) => [{ type: "text", text: { content, link: null }, plain_text: content, href: null, annotations: {} }];

export const COLUMNS = {
  Name: { id: "title", name: "Name", type: "title", title: {} },
  Status: {
    id: "st%3A1",
    name: "Status",
    type: "status",
    status: {
      options: [
        { id: "s1", name: "Not started", color: "default" },
        { id: "s2", name: "In progress", color: "blue" },
        { id: "s3", name: "Done", color: "green" },
      ],
      groups: [
        { id: "g1", name: "To-do", color: "gray", option_ids: ["s1"] },
        { id: "g2", name: "In progress", color: "blue", option_ids: ["s2"] },
        { id: "g3", name: "Complete", color: "green", option_ids: ["s3"] },
      ],
    },
  },
  Tags: { id: "tg", name: "Tags", type: "multi_select", multi_select: { options: [{ id: "t1", name: "Web", color: "gray" }] } },
  Priority: { id: "pr", name: "Priority", type: "select", select: { options: [{ id: "o1", name: "Low", color: "gray" }, { id: "o2", name: "High", color: "red" }] } },
  Budget: { id: "bu", name: "Budget", type: "number", number: { format: "euro" } },
  Due: { id: "du", name: "Due", type: "date", date: {} },
  Billable: { id: "bl", name: "Billable", type: "checkbox", checkbox: {} },
  Link: { id: "ln", name: "Link", type: "url", url: {} },
  Company: { id: "co", name: "Company", type: "relation", relation: { data_source_id: ID.other, database_id: ID.other, type: "single_property", single_property: {} } },
  Score: { id: "fx", name: "Score", type: "formula", formula: { expression: "prop(\"Budget\") / 1000" } },
  Notes: { id: "nt", name: "Notes", type: "rich_text", rich_text: {} },
} as const;

export const dataSource = (over: Record<string, unknown> = {}): RawDataSource =>
  ({
    object: "data_source",
    id: ID.source,
    title: text("Projects"),
    description: [],
    parent: { type: "database_id", database_id: ID.database },
    database_parent: { type: "page_id", page_id: ID.page },
    is_inline: false,
    in_trash: false,
    created_time: "2026-09-01T10:00:00.000Z",
    last_edited_time: "2026-09-28T10:00:00.000Z",
    properties: COLUMNS,
    url: `https://www.notion.so/${ID.source.replace(/-/g, "")}`,
    ...over,
  }) as unknown as RawDataSource;

export const database = (over: Record<string, unknown> = {}): RawDatabase =>
  ({
    object: "database",
    id: ID.database,
    title: text("Project Tracker"),
    description: [],
    parent: { type: "page_id", page_id: ID.page },
    is_inline: false,
    in_trash: false,
    is_locked: false,
    created_time: "2026-09-01T10:00:00.000Z",
    last_edited_time: "2026-09-28T10:00:00.000Z",
    data_sources: [{ id: ID.source, name: "Projects" }],
    url: `https://www.notion.so/${ID.database.replace(/-/g, "")}`,
    ...over,
  }) as unknown as RawDatabase;

export const row = (over: Record<string, unknown> = {}, properties: Record<string, unknown> = {}): RawPage =>
  ({
    object: "page",
    id: ID.row,
    created_time: "2026-09-20T10:00:00.000Z",
    last_edited_time: "2026-09-28T10:00:00.000Z",
    in_trash: false,
    is_locked: false,
    url: "https://www.notion.so/Acme-22222222222242228222222222222222",
    public_url: null,
    parent: { type: "data_source_id", data_source_id: ID.source, database_id: ID.database },
    properties: {
      Name: { id: "title", type: "title", title: text("Acme") },
      Status: { id: "st%3A1", type: "status", status: { id: "s1", name: "Not started", color: "default" } },
      Tags: { id: "tg", type: "multi_select", multi_select: [] },
      Budget: { id: "bu", type: "number", number: 5000 },
      Notes: { id: "nt", type: "rich_text", rich_text: [] },
      ...properties,
    },
    ...over,
  }) as unknown as RawPage;

export const childPage = (over: Record<string, unknown> = {}): RawPage =>
  ({
    object: "page",
    id: ID.page,
    created_time: "2026-09-01T10:00:00.000Z",
    last_edited_time: "2026-09-28T10:00:00.000Z",
    in_trash: false,
    is_locked: false,
    url: "https://www.notion.so/Home-11111111111141118111111111111111",
    public_url: null,
    parent: { type: "workspace", workspace: true },
    properties: { title: { id: "title", type: "title", title: text("Home") } },
    ...over,
  }) as unknown as RawPage;

/** A port whose every call fails as "not here" unless a test overrides it. */
export const missingPort = (account: string): NotionPort => {
  const miss = async (): Promise<never> => fail({ kind: "not_shared", accounts: [account], message: "not here" });
  return {
    me: miss,
    listUsers: miss,
    search: miss,
    getPage: miss,
    getPropertyItems: miss,
    getMarkdown: miss,
    getBlock: miss,
    listBlockChildren: miss,
    getDatabase: miss,
    getDataSource: miss,
    listTemplates: async () => ({ templates: [], has_more: false, next_cursor: null }),
    listViews: miss,
    getView: miss,
    queryView: miss,
    viewQueryPage: miss,
    query: miss,
    addColumn: miss,
    setOptions: miss,
    createDatabase: miss,
    createPage: miss,
    createFileUpload: miss,
    sendFileUpload: miss,
    appendFileBlock: miss,
    updatePage: miss,
    movePage: miss,
    editContent: miss,
    listComments: miss,
    addComment: miss,
  };
};

/** Deps over fake ports, one per label; the locator is the real one, over those ports. */
export const fakeDeps = (ports: Readonly<Record<string, Partial<NotionPort>>>): Deps => {
  const built = Object.fromEntries(Object.entries(ports).map(([label, over]) => [label, { ...missingPort(label), ...over }]));
  const accounts: Accounts = {
    source: "/nonexistent/tokens",
    labels: async () => Object.keys(built).sort(),
    api: (label) => built[label] ?? missingPort(label),
  };
  return {
    accounts,
    locator: makeLocator(accounts),
    schema: (account, id) => accounts.api(account).getDataSource(id),
    users: (account) => readAllUsers(accounts.api(account)),
    readInput: inputFilesWith([]),
    outbox: undefined,
    download: async () => fail({ kind: "api", status: 0, message: "no download in this test" }),
  };
};
