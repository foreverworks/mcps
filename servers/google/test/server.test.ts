/**
 * The merged server as a client sees it: one tool list for both products, the
 * account tools answering per product, and a broken product not hiding the
 * other. No credential and no network: every account here points at files that
 * do not exist, which list_accounts never opens and health reports per account.
 */
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, connectInMemory, inSeries, McpServer, OK, PERMANENT, registeredNames, TRANSIENT, verdictOf, worst } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { runHealthCheck } from "../src/cli/health.js";
import { buildRegistries } from "../src/composition.js";
import { authError, apiError, configError, needsHuman } from "../src/domain/errors.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

const connected = async (env: NodeJS.ProcessEnv): Promise<Client> => {
  const server = new McpServer({ name: "google", version: "test" });
  registerAll(server, buildRegistries(env));
  const client = await connectInMemory(server);
  return client;
};

const envWith = async (): Promise<NodeJS.ProcessEnv> => {
  const dir = await mkdtemp(join(tmpdir(), "google-server-"));
  // The state dirs exist in a deployment; the token cache locks inside them.
  await Promise.all(["personal", "work"].map((label) => mkdir(join(dir, "state", label), { recursive: true })));
  return {
    GMAIL_ACCOUNTS: `personal=${join(dir, "personal.json")},work=${join(dir, "work.json")}`,
    GMAIL_STATE_DIR: join(dir, "state"),
    CALENDAR_ROOT: join(dir, "calendar"),
    DRIVE_RCLONE_CONF: join(dir, "no-rclone.conf"),
    // Its own token cache too: a fresh token in a real cache would let the test reach a real Drive.
    DRIVE_STATE_DIR: join(dir, "drive-state"),
    GOOGLE_EDITORS_ROOT: join(dir, "editors"),
    GOOGLE_EDITORS_DRIVE_ACCOUNT: "work",
  };
};

describe("the google server", () => {
  it("serves both products' tools under unique names, with one list_accounts and one health", async () => {
    const client = await connected(await envWith());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining(["list_accounts", "health", "search_threads", "trash", "agenda", "create_event", "list_folder", "move_file", "trash_file"]),
    );
    expect(names).toEqual(
      expect.arrayContaining(["read_document", "edit_document_section", "read_rows", "upsert_rows", "add_chart", "create_deck_from_outline", "get_thumbnails"]),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "editors_api_reference",
        "get_document",
        "find_in_document",
        "batch_update_document",
        "get_spreadsheet",
        "get_values",
        "update_values",
        "clear_values",
        "append_values",
        "batch_update_spreadsheet",
        "copy_sheet_to",
        "get_presentation",
        "batch_update_presentation",
        "create_presentation",
        "search_developer_metadata",
        "list_comments",
        "add_comment",
        "reply_to_comment",
        "edit_comment",
        "delete_comment",
        "list_permissions",
        "share_file",
        "update_permission",
        "remove_permission",
        "list_revisions",
        "download_revision",
        "update_revision",
      ]),
    );
    expect(names.filter((n) => n === "list_accounts" || n === "health")).toHaveLength(2);
  });

  it("lists accounts per product, and says so when a product has none", async () => {
    const client = await connected(await envWith());
    const listed = parse(await client.callTool({ name: "list_accounts", arguments: {} }));
    expect(listed.gmail.accounts.map((a: { account: string }) => a.account)).toEqual(["personal", "work"]);
    expect(listed.gmail.defaultAccount).toBe("personal");
    expect(listed.calendar.accounts).toEqual([]);
    expect(listed.calendar.hint).toMatch(/no account has a grant/);
    expect(listed.drive.grant).toMatchObject({ source: "rclone" });
    expect(listed.editors.accounts).toEqual([expect.objectContaining({ account: "work", source: "drive", default: true })]);
    expect(listed.editors.hint).toBeUndefined();
    for (const product of ["tasks", "contacts", "meet"]) {
      expect(listed[product]).toEqual({ accounts: [], hint: expect.stringContaining(`begin_consent (product ${product}`) });
    }
  });

  it("counts a product nobody has consented yet as healthy: nothing that worked has stopped", async () => {
    const client = await connected(await envWith());
    const checked = parse(await client.callTool({ name: "health", arguments: {} }));
    for (const product of ["tasks", "contacts", "meet"]) expect(checked[product]).toEqual({ accounts: [], allOk: true });
  });

  it("reports a Drive with no grant in its own section, without taking the others down", async () => {
    const client = await connected(await envWith());
    const checked = parse(await client.callTool({ name: "health", arguments: {} }));
    expect(checked.drive.error).toMatch(/cannot read the rclone config/);
    expect(checked.editors.accounts).toEqual([expect.objectContaining({ account: "work", ok: false, error: expect.stringMatching(/cannot read the rclone config/) })]);
    expect(checked.gmail.accounts).toHaveLength(2);
    expect(checked.allOk).toBe(false);
  });

  it("keeps one product's failure out of the other's section", async () => {
    const client = await connected(await envWith());
    const checked = parse(await client.callTool({ name: "health", arguments: { account: "work" } }));
    expect(checked.gmail.accounts).toHaveLength(1);
    expect(checked.gmail.accounts[0]).toMatchObject({ account: "work", ok: false });
    expect(checked.calendar.error).toMatch(/no calendar grant for "work"/);
    // Tasks, Contacts and Meet are consented by choice: an account without them has none, which is not a fault.
    for (const product of ["tasks", "contacts", "meet"]) expect(checked[product]).toMatchObject({ accounts: [], allOk: true });
    expect(checked.allOk).toBe(false);
  });
});

describe("with an empty environment", () => {
  it("starts, lists every product, and points each unconfigured one at its variables", async () => {
    const client = await connected({ GOOGLE_STATE_DIR: await mkdtemp(join(tmpdir(), "google-empty-")) });
    const listed = parse(await client.callTool({ name: "list_accounts", arguments: {} }));
    expect(listed.gmail).toMatchObject({ accounts: [], hint: expect.stringMatching(/GMAIL_MODIFY_ACCOUNTS/) });
    expect(listed.drive.grant).toMatchObject({ source: "none", detail: expect.stringMatching(/DRIVE_CREDENTIALS/) });
    expect(listed.editors).toMatchObject({ accounts: [], hint: expect.stringMatching(/no account has a grant yet/) });
    const searched = await client.callTool({ name: "search_threads", arguments: {} });
    expect(searched.isError).toBe(true);
    expect(parse(searched).error).toMatchObject({ kind: "config", message: expect.stringMatching(/GMAIL_MODIFY_ACCOUNTS/) });
    const read = parse(await client.callTool({ name: "read_rows", arguments: { spreadsheet_id: "1AbCdEfGhIjKlMnOp" } }));
    expect(read.error).toMatchObject({ kind: "config", message: expect.stringMatching(/GOOGLE_EDITORS_DRIVE_ACCOUNT/) });
    const listedFolder = parse(await client.callTool({ name: "list_folder", arguments: {} }));
    expect(listedFolder.error).toMatchObject({ kind: "config", message: expect.stringMatching(/DRIVE_RCLONE_CONF/) });
  });
});

describe("health verdicts", () => {
  it("wakes a human only for what a human can fix", () => {
    expect(verdictOf(needsHuman(authError("invalid_grant", "revoked")))).toEqual({ code: PERMANENT, word: "FAIL" });
    expect(verdictOf(needsHuman(configError("no file")))).toEqual({ code: PERMANENT, word: "FAIL" });
    expect(verdictOf(needsHuman(apiError(403, "scope")))).toEqual({ code: PERMANENT, word: "FAIL" });
    expect(verdictOf(needsHuman(apiError(503, "unwell")))).toEqual({ code: TRANSIENT, word: "WARN" });
  });

  it("reports the worst line", () => {
    expect(worst([OK, TRANSIENT, OK])).toBe(TRANSIENT);
    expect(worst([TRANSIENT, PERMANENT])).toBe(PERMANENT);
    expect(worst([])).toBe(OK);
  });

  it("runs in series, in order", async () => {
    expect(await inSeries([3, 1, 2], async (n) => n * 10)).toEqual([30, 10, 20]);
  });

  it("refuses a product it does not have, loudly and on a line of its own", async () => {
    const lines: string[] = [];
    expect(await runHealthCheck("photos", (line) => lines.push(line), {})).toBe(PERMANENT);
    expect(lines).toEqual([expect.stringMatching(/^HEALTH: FAIL unknown product "photos"/)]);
  });

  it("checks drive alone when asked, with its own prefix", async () => {
    const env = await envWith();
    const lines: string[] = [];
    expect(await runHealthCheck("drive", (line) => lines.push(line), env)).toBe(PERMANENT);
    expect(lines).toEqual([expect.stringMatching(/^DRIVE: FAIL cannot read the rclone config/)]);
  });

  it("checks Docs, Sheets and Slides alone when asked, one EDITORS line per account", async () => {
    const env = await envWith();
    const lines: string[] = [];
    expect(await runHealthCheck("editors", (line) => lines.push(line), env)).toBe(PERMANENT);
    expect(lines).toEqual([expect.stringMatching(/^EDITORS: FAIL account=work cannot read the rclone config/)]);
  });

  it("passes Tasks, Contacts and Meet with no grant yet, each saying how to make one", async () => {
    const env = await envWith();
    for (const [product, prefix] of [["tasks", "TASKS"], ["contacts", "CONTACTS"], ["meet", "MEET"]] as const) {
      const lines: string[] = [];
      expect(await runHealthCheck(product, (line) => lines.push(line), env)).toBe(OK);
      expect(lines).toEqual([expect.stringMatching(new RegExp(`^${prefix}: ok no account has a ${product} grant yet`))]);
    }
  });

  it("checks calendar alone when asked, with its own prefix", async () => {
    const env = await envWith();
    const lines: string[] = [];
    expect(await runHealthCheck("calendar", (line) => lines.push(line), env)).toBe(PERMANENT);
    expect(lines).toEqual([expect.stringMatching(/^CALENDAR: FAIL no account has a grant under /)]);
  });
});

describe("the tool policy", () => {
  it("classifies exactly the tools the server registers, Docs/Sheets/Slides reads as read and the rest as write", async () => {
    const env = await envWith();
    const names = registeredNames((server) => registerAll(server, buildRegistries(env)));
    expect([...names].sort()).toEqual(Object.keys(POLICY).sort());
    const access = (tools: readonly string[]) => tools.map((t) => POLICY[t]?.access);
    expect(access(["read_document", "list_sheets", "read_rows", "list_layouts", "read_deck", "get_thumbnails"])).toEqual(Array(6).fill("read"));
    expect(
      access(["edit_document_section", "create_document", "append_to_document", "append_rows", "upsert_rows", "write_range", "format_range", "add_chart", "create_spreadsheet", "create_deck_from_outline", "fill_placeholders"]),
    ).toEqual(Array(11).fill("write"));
  });
});
