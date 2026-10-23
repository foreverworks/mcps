/**
 * GOOGLE_TOOLSETS: unset or `all` serves what the server always served (the
 * snapshot in tools.test.ts, and the instructions below, word for word); a
 * subset serves only its products' tools, and the instructions, list_accounts
 * and health name nothing else; an unknown name stops the start. No
 * credential and no network: every account points at files that do not exist.
 */
import { checkPolicy, connectInMemory, guard, McpServer, type Tool } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildRegistries } from "../src/composition.js";
import { instructionsFor } from "../src/mcp/instructions.js";
import { ALL_TOOLSETS, ALWAYS, policyFor, POLICY, TOOLSETS, type Toolset } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { loadedToolsets, productsOf } from "../src/mcp/toolsets.js";
import { FIXED_ENV } from "./fixedEnv.js";

const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

/** A client of the server with these toolsets loaded, as index.ts builds it. */
const serverWith = async (loaded: readonly Toolset[]) => {
  const server = new McpServer({ name: "google", version: "test" }, { instructions: instructionsFor(loaded) });
  registerAll(guard(server, { service: "google", policy: policyFor(loaded), log: () => undefined }), buildRegistries(FIXED_ENV), loaded);
  return connectInMemory(server);
};

const toolsOf = async (loaded: readonly Toolset[]): Promise<readonly Tool[]> => (await (await serverWith(loaded)).listTools()).tools;

/** The tool names a text mentions: snake_case words, and the batch_update_* family. */
const toolNamesIn = (text: string): readonly string[] => [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+(?:_\*)?/g) ?? [])];

/** The text every deployment saw before toolsets existed, which an unset GOOGLE_TOOLSETS must keep giving. */
const INSTRUCTIONS_BEFORE_TOOLSETS =
  "Several Google accounts through one server: Gmail, Calendar, a Drive, Docs, Sheets and Slides, Google Tasks, " +
  "contacts with a Workspace directory, and Meet's transcripts. Start with " +
  "list_accounts: it names each account label (one label is one identity in every product) and which products " +
  "reach it. The reads that make sense across accounts (search_threads, agenda, free_busy, list_tasks, find_people) read every account " +
  "when none is given; every write names its account, because there is no default for one, and Drive tools take " +
  "none. To address someone by name, find_people finds the address. For mail, create_draft is the default for anything addressed to someone: send_message, send_draft, " +
  "reply or forward with send, and share_file act only on the user's explicit go for that message or file. In " +
  "Docs, read_document comes before edit_document_section, which is pinned to the revision read; before any " +
  "batch_update_* call, editors_api_reference says what each request takes. A meeting's transcript and notes: " +
  "list_meetings (from an agenda event), then get_transcript. Files come back through the " +
  "server's outbox with their SHA-256 (get_attachment, harvest_attachments, download_file) and go in by path " +
  "(upload_file). When health or a tool says a grant is missing or lapsed, begin_consent returns the link the " +
  "account's owner opens, and complete_consent takes the address it lands on.";

describe("GOOGLE_TOOLSETS unset or all", () => {
  it("loads every toolset", () => {
    expect(loadedToolsets({})).toEqual(ALL_TOOLSETS);
    expect(loadedToolsets({ GOOGLE_TOOLSETS: "" })).toEqual(ALL_TOOLSETS);
    expect(loadedToolsets({ GOOGLE_TOOLSETS: "all" })).toEqual(ALL_TOOLSETS);
    expect(loadedToolsets({ GOOGLE_TOOLSETS: "gmail,all" })).toEqual(ALL_TOOLSETS);
  });

  it("serves every tool of the policy, 115 of them, and the instructions it always gave", async () => {
    const tools = await toolsOf(loadedToolsets({}));
    expect(tools.map((t) => t.name)).toEqual(Object.keys(POLICY).sort());
    expect(tools).toHaveLength(115);
    expect(instructionsFor(loadedToolsets({}))).toBe(INSTRUCTIONS_BEFORE_TOOLSETS);
  });

  it("puts every tool of the server in a toolset, or among the four always loaded", () => {
    const inToolsets = new Set(Object.values(TOOLSETS).flatMap((part) => Object.keys(part)));
    expect(Object.keys(ALWAYS).sort()).toEqual(["begin_consent", "complete_consent", "health", "list_accounts"]);
    expect(Object.keys(POLICY).filter((tool) => !inToolsets.has(tool)).sort()).toEqual(Object.keys(ALWAYS).sort());
  });
});

describe("an unknown toolset", () => {
  it("stops the start, naming the toolsets there are", () => {
    expect(() => loadedToolsets({ GOOGLE_TOOLSETS: "gmail,photos" })).toThrow(
      'GOOGLE_TOOLSETS names "photos", which is not a toolset: the toolsets are gmail, calendar, drive, docs, sheets, slides, collaboration, tasks, contacts, meet, or all (the default)',
    );
  });
});

describe("GOOGLE_TOOLSETS=gmail,calendar", () => {
  const loaded = loadedToolsets({ GOOGLE_TOOLSETS: "gmail, calendar" });

  it("serves Gmail's and Calendar's tools and the four always loaded, and nothing else", async () => {
    expect(loaded).toEqual(["gmail", "calendar"]);
    const names = (await toolsOf(loaded)).map((t) => t.name);
    expect(names).toEqual([...Object.keys(ALWAYS), ...Object.keys(TOOLSETS.gmail), ...Object.keys(TOOLSETS.calendar)].sort());
    expect(names).not.toContain("list_folder");
    expect(names).not.toContain("editors_api_reference");
  });

  it("tells the client about mail and calendars only", async () => {
    const client = await serverWith(loaded);
    expect(client.getInstructions()).toBe(
      "Several Google accounts through one server: Gmail and Calendar. Start with list_accounts: it names each account label " +
        "(one label is one identity in every product) and which products reach it. The reads that make sense across accounts " +
        "(search_threads, agenda, free_busy) read every account when none is given; every write names its account, because there " +
        "is no default for one. For mail, create_draft is the default for anything addressed to someone: send_message, send_draft, " +
        "reply or forward with send act only on the user's explicit go for that message. Files come back through the server's " +
        "outbox with their SHA-256 (get_attachment, harvest_attachments). When health or a tool says a grant is " +
        "missing or lapsed, begin_consent returns the link the account's owner opens, and complete_consent takes the address it lands on.",
    );
  });

  it("answers list_accounts and health with Gmail's and Calendar's sections, and describes no other", async () => {
    const client = await serverWith(loaded);
    const listed = parse(await client.callTool({ name: "list_accounts", arguments: {} }));
    expect(Object.keys(listed)).toEqual(["gmail", "calendar"]);
    const checked = parse(await client.callTool({ name: "health", arguments: {} }));
    expect(Object.keys(checked)).toEqual(["gmail", "calendar", "allOk"]);
    const described = (await client.listTools()).tools.filter((t) => t.name === "list_accounts" || t.name === "health").map((t) => t.description ?? "");
    for (const description of described) {
      expect(description).toMatch(/Under `gmail`/);
      expect(description).toMatch(/Under `calendar`/);
      expect(description).not.toMatch(/`drive`|`editors`|`tasks`|`contacts`|`meet`/);
    }
  });
});

describe("each toolset alone", () => {
  for (const toolset of ALL_TOOLSETS) {
    it(`${toolset}: registers exactly its policy, and the instructions name only tools it serves`, async () => {
      const loaded = [toolset] as const;
      const registries = buildRegistries(FIXED_ENV);
      expect(() => checkPolicy("google", (server) => registerAll(server, registries, loaded), policyFor(loaded))).not.toThrow();
      const served = new Set((await toolsOf(loaded)).map((t) => t.name));
      const named = toolNamesIn(instructionsFor(loaded)).filter((word) => word !== "batch_update_*");
      expect(named.filter((tool) => !served.has(tool))).toEqual([]);
      for (const [, tools] of productsOf(loaded)) for (const tool of Object.keys(tools)) expect(served.has(tool)).toBe(true);
    });
  }

  it("keeps the editors' section for comments and sharing, which run as an editors account", async () => {
    const client = await serverWith(["collaboration"]);
    expect(Object.keys(parse(await client.callTool({ name: "list_accounts", arguments: {} })))).toEqual(["editors"]);
  });

  it("narrows the editors' API reference to the editors loaded", async () => {
    const tools = await toolsOf(["sheets"]);
    const reference = tools.find((t) => t.name === "editors_api_reference");
    expect(reference?.title).toBe("Sheets API reference");
    expect(reference?.inputSchema.properties?.["api"]).toMatchObject({ enum: ["sheets"] });
    expect(toolNamesIn(reference?.description ?? "").filter((word) => word.startsWith("batch_update"))).toEqual(["batch_update_spreadsheet"]);
    const answered = parse(await (await serverWith(["sheets"])).callTool({ name: "editors_api_reference", arguments: { api: "sheets", name: "repeatCell" } }));
    expect(answered.error).toBeUndefined();
  });
});
