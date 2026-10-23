import { describe, expect, it } from "vitest";

import { chooseAccounts } from "../src/domain/accounts.js";
import { toBlock } from "../src/domain/blocks.js";
import { columnsOf, findColumn } from "../src/domain/columns.js";
import { insertEdit, replaceEdit, updateEdit } from "../src/domain/content.js";
import { decodeCursors, encodeCursors } from "../src/domain/cursor.js";
import { parseDate } from "../src/domain/dates.js";
import { parseId, toBlockId, toId, urlOf } from "../src/domain/ids.js";
import { toHit, toRow } from "../src/domain/models.js";
import { readProperties, readValue } from "../src/domain/properties/read.js";
import { rowWrites, toWrites } from "../src/domain/properties/write.js";
import { planQuery } from "../src/domain/query.js";
import type { RawBlock, RawPropertyValue } from "../src/domain/schema.js";
import { pickSource } from "../src/domain/sources.js";
import { RUN_LIMIT, toRuns } from "../src/domain/text.js";
import { database, dataSource, errorOf, ID, row } from "./helpers.js";

const columns = columnsOf(dataSource());
const value = (raw: unknown) => readValue(raw as RawPropertyValue);

describe("ids", () => {
  const bare = "5c1d0e2f3a4b4c6d8e9f0a1b2c3d4e5f";
  const dashed = "5c1d0e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f";

  it("reads every shape an id arrives in", () => {
    expect(parseId(dashed)).toBe(dashed);
    expect(parseId(bare.toUpperCase())).toBe(dashed);
    expect(parseId(`https://app.notion.com/p/${bare}`)).toBe(dashed);
    expect(parseId(`https://www.notion.so/example/Project-Tracker-${bare}?v=abc`)).toBe(dashed);
    expect(parseId(`https://example.notion.site/Page-${bare}#aaaabbbbccccddddeeeeffff00001111`)).toBe(dashed);
  });

  it("takes the block a URL's fragment names when a block is asked for", () => {
    const block = "aaaabbbbccccddddeeeeffff00001111";
    expect(toBlockId(`https://app.notion.com/p/${bare}#${block}`)).toBe("aaaabbbb-cccc-dddd-eeee-ffff00001111");
    expect(toBlockId(`https://app.notion.com/p/${bare}`)).toBe(dashed);
    expect(toBlockId(dashed)).toBe(dashed);
  });

  it("takes the page open on top of a database, not the database", () => {
    const db = "11111111111111111111111111111111";
    expect(parseId(`https://www.notion.so/ws/${db}?v=2222&p=${bare}&pm=s`)).toBe(dashed);
  });

  it("refuses what holds no id, and a host that is not Notion's", async () => {
    expect(parseId("Project Tracker")).toBeUndefined();
    expect(parseId(`https://example.com/${bare}`)).toBeUndefined();
    expect(await errorOf(() => toId("nope", "page"))).toMatchObject({ kind: "input" });
  });

  it("rebuilds a URL that opens the object in any workspace", () => {
    expect(urlOf(dashed)).toBe(`https://www.notion.so/${bare}`);
  });
});

describe("accounts", () => {
  it("means every account by default or with *, one when named, and refuses a stranger", async () => {
    expect(chooseAccounts(undefined, ["personal", "work"])).toEqual(["personal", "work"]);
    expect(chooseAccounts("*", ["personal", "work"])).toEqual(["personal", "work"]);
    expect(chooseAccounts("work", ["personal", "work"])).toEqual(["work"]);
    expect(await errorOf(() => chooseAccounts("home", ["personal", "work"]))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => chooseAccounts(undefined, []))).toMatchObject({ kind: "config" });
  });
});

describe("text", () => {
  it("splits into runs Notion accepts, never inside a character", () => {
    const long = "é".repeat(RUN_LIMIT) + "🙂".repeat(3);
    const runs = toRuns(long);
    expect(runs.every((r) => r.length <= RUN_LIMIT)).toBe(true);
    expect(runs.join("")).toBe(long);
    expect(runs[1]).toBe("🙂".repeat(3));
  });
});

describe("columns", () => {
  it("puts the title first and carries options, status groups, relation targets", () => {
    expect(columns[0]).toMatchObject({ name: "Name", type: "title" });
    expect(findColumn(columns, "Status")).toMatchObject({
      options: ["Not started", "In progress", "Done"],
      groups: [
        { name: "To-do", options: ["Not started"] },
        { name: "In progress", options: ["In progress"] },
        { name: "Complete", options: ["Done"] },
      ],
    });
    expect(findColumn(columns, "Company").relatesTo).toBe(ID.other);
  });

  it("finds a column ignoring case, and refuses an unknown one with the names", async () => {
    expect(findColumn(columns, "budget").name).toBe("Budget");
    const error = await errorOf(() => findColumn(columns, "Budgt"));
    expect(error).toMatchObject({ kind: "input" });
    expect(error?.message).toContain('"Budget"');
  });
});

describe("reading values", () => {
  it("makes each type its plainest value", () => {
    expect(value({ type: "select", select: { id: "1", name: "Low", color: "gray" } })).toBe("Low");
    expect(value({ type: "date", date: { start: "2026-09-28", end: null, time_zone: null } })).toEqual({ start: "2026-09-28" });
    expect(value({ type: "relation", relation: [{ id: ID.other }] })).toEqual([ID.other]);
    expect(value({ type: "unique_id", unique_id: { prefix: "PRJ", number: 12 } })).toBe("PRJ-12");
    expect(value({ type: "formula", formula: { type: "number", number: 5 } })).toBe(5);
    expect(value({ type: "rollup", rollup: { type: "array", function: "show_original", array: [{ type: "number", number: 2 }] } })).toEqual([2]);
    expect(value({ type: "files", files: [{ name: "brief.pdf", type: "external", external: { url: "https://x.test/brief.pdf" } }] })).toEqual([
      { name: "brief.pdf", url: "https://x.test/brief.pdf" },
    ]);
    expect(value({ type: "button", button: {} })).toBeUndefined();
    expect(value({ type: "something_new" })).toBe("<something_new>");
  });

  it("leaves empty values out and names a relation Notion cut at 25", () => {
    const read = readProperties(row({}, { Company: { id: "co", type: "relation", relation: [{ id: ID.other }], has_more: true } }).properties);
    expect(read.values).toEqual({ Name: "Acme", Status: "Not started", Budget: 5000, Company: [ID.other] });
    expect(read.truncated).toEqual([{ name: "Company", propertyId: "co" }]);
  });

  it("shows a row as its title and its other columns", () => {
    expect(toRow(row())).toEqual({ id: ID.row, title: "Acme", properties: { Status: "Not started", Budget: 5000 } });
  });

  it("finds a database through its data source, with both ids", () => {
    expect(toHit("work", dataSource())).toMatchObject({ account: "work", kind: "database", id: ID.database, dataSourceId: ID.source, title: "Projects" });
  });
});

describe("writing values", () => {
  const opts = { allowNewOptions: false };

  it("checks each value against its column", () => {
    const writes = toWrites(columns, { Status: "in progress", Tags: ["web"], Budget: 6000, Due: "2026-09-28", Billable: true, Link: "", Company: [`https://www.notion.so/${ID.other.replace(/-/g, "")}`] }, opts);
    expect(writes).toEqual({
      Status: { type: "status", name: "In progress" },
      Tags: { type: "multi_select", names: ["Web"] },
      Budget: { type: "number", value: 6000 },
      Due: { type: "date", date: { start: "2026-09-28" } },
      Billable: { type: "checkbox", value: true },
      Link: { type: "url", value: null },
      Company: { type: "relation", ids: [ID.other] },
    });
  });

  it("refuses an option that does not exist unless asked, and a status always", async () => {
    expect(await errorOf(() => toWrites(columns, { Priority: "Urgent" }, opts))).toMatchObject({ kind: "input" });
    expect(toWrites(columns, { Priority: "Urgent" }, { allowNewOptions: true })).toEqual({ Priority: { type: "select", name: "Urgent" } });
    const status = await errorOf(() => toWrites(columns, { Status: "Blocked" }, { allowNewOptions: true }));
    expect(status?.message).toContain("cannot add one");
  });

  it("refuses a computed column, a wrong type, a column named twice", async () => {
    expect((await errorOf(() => toWrites(columns, { Score: 1 }, opts)))?.message).toContain("computes it");
    expect(await errorOf(() => toWrites(columns, { Budget: "6000" }, opts))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => toWrites(columns, { Budget: 1, budget: 2 }, opts))).toMatchObject({ kind: "input" });
  });

  it("puts a row's title into the title column, once", async () => {
    expect(rowWrites(columns, "Globex", {}, opts)).toEqual({ Name: { type: "title", runs: ["Globex"] } });
    expect(await errorOf(() => rowWrites(columns, "Globex", { Name: "Globex" }, opts))).toMatchObject({ kind: "input" });
  });

  it("reads a date, a date-time and a range, and refuses a typo or a range backwards", async () => {
    expect(parseDate("2026-09-28T14:30:00+03:00", "d")).toEqual({ start: "2026-09-28T14:30:00+03:00" });
    expect(parseDate({ start: "2026-09-28", end: "2026-09-30", time_zone: "Europe/Bucharest" }, "d")).toEqual({ start: "2026-09-28", end: "2026-09-30", timeZone: "Europe/Bucharest" });
    expect(await errorOf(() => parseDate("28.09.2026", "d"))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => parseDate({ start: "2026-09-30", end: "2026-09-28" }, "d"))).toMatchObject({ kind: "input" });
  });
});

describe("planning a query", () => {
  const base = { where: [], match: "all" as const, sort: [], limit: 50, inTrash: false };

  it("types each condition from the schema", () => {
    const plan = planQuery(columns, {
      ...base,
      where: [
        { property: "Status", op: "equals", value: ["not started", "In progress"] },
        { property: "Due", op: "past_week" },
        { property: "Notes", op: "is_empty" },
        { property: "Score", op: "greater_than", value: 3 },
        { timestamp: "last_edited_time", op: "after", value: "one_week_ago" },
      ],
    });
    expect(plan.filter).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { kind: "property", property: "Status", key: "status", op: "equals", value: ["Not started", "In progress"] },
        { kind: "property", property: "Due", key: "date", op: "past_week", value: {} },
        { kind: "property", property: "Notes", key: "rich_text", op: "is_empty", value: true },
        { kind: "formula", property: "Score", result: "number", op: "greater_than", value: 3 },
        { kind: "timestamp", timestamp: "last_edited_time", op: "after", value: "one_week_ago" },
      ],
    });
  });

  it("refuses an op the type lacks with the ones it has, and an option that does not exist", async () => {
    const op = await errorOf(() => planQuery(columns, { ...base, where: [{ property: "Budget", op: "contains", value: 1 }] }));
    expect(op?.message).toContain("greater_than");
    const option = await errorOf(() => planQuery(columns, { ...base, where: [{ property: "Priority", op: "equals", value: "Urgent" }] }));
    expect(option?.message).toContain('"Low"');
  });

  it("ANDs notion_filter with where, returns the title always, and caps a page at 100", () => {
    const plan = planQuery(columns, {
      ...base,
      where: [{ property: "Billable", op: "equals", value: true }],
      notionFilter: { or: [] },
      properties: ["Status"],
      sort: [{ property: "due", direction: "descending" }],
      limit: 500,
    });
    expect(plan.filter).toMatchObject({ kind: "group", match: "all", filters: [{ key: "checkbox" }, { kind: "raw" }] });
    expect(plan.propertyIds).toEqual(["title", "st%3A1"]);
    expect(plan.sorts).toEqual([{ kind: "property", property: "Due", direction: "descending" }]);
    expect(plan.pageSize).toBe(100);
  });
});

describe("the rest of the domain", () => {
  it("picks the one data source, or the one named, and refuses a guess", async () => {
    expect(pickSource(database())).toBe(ID.source);
    const two = database({ data_sources: [{ id: ID.source, name: "Projects" }, { id: ID.other, name: "Archive" }] });
    expect(pickSource(two, "archive")).toBe(ID.other);
    expect((await errorOf(() => pickSource(two)))?.message).toContain('"Archive"');
  });

  it("round-trips a multi-account cursor and refuses a forged one", async () => {
    const cursor = encodeCursors({ work: "abc", personal: "def" }) as string;
    expect(decodeCursors(cursor)).toEqual({ work: "abc", personal: "def" });
    expect(encodeCursors({})).toBeUndefined();
    expect(await errorOf(() => decodeCursors("not-a-cursor"))).toMatchObject({ kind: "input" });
  });

  it("checks a content edit before anything is sent", async () => {
    expect(insertEdit("## Notes", "end", undefined)).toEqual({ kind: "insert", markdown: "## Notes", at: "end" });
    expect(insertEdit("x", "end", "Intro...done")).toEqual({ kind: "insert", markdown: "x", at: { after: "Intro...done" } });
    expect(await errorOf(() => insertEdit("  ", "end", undefined))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => updateEdit([{ old: "", new: "x", all: false }], false))).toMatchObject({ kind: "input" });
  });

  it("empties a page's body only when told to on purpose", async () => {
    expect(replaceEdit("# New", false, false)).toEqual({ kind: "replace", markdown: "# New", allowDeleting: false });
    expect(await errorOf(() => replaceEdit("", false, false))).toMatchObject({ kind: "input", message: expect.stringContaining("clear: true") });
    expect(await errorOf(() => replaceEdit(" \n ", true, false))).toMatchObject({ kind: "input" });
    expect(replaceEdit(" \n", false, true)).toEqual({ kind: "replace", markdown: "", allowDeleting: false });
    expect(await errorOf(() => replaceEdit("# New", false, true))).toMatchObject({ kind: "input", message: expect.stringContaining('markdown ""') });
  });
});

describe("blocks", () => {
  const block = (over: Record<string, unknown>) =>
    toBlock({ object: "block", id: ID.other, has_children: false, in_trash: false, ...over } as unknown as RawBlock);
  const runs = (content: string) => [{ type: "text", text: { content, link: null }, plain_text: content, href: null, annotations: {} }];

  it("shows a block's text and leaves colours and empty values behind", () => {
    expect(block({ type: "paragraph", paragraph: { rich_text: runs("Is this net or gross?"), color: "default" } })).toEqual({
      id: ID.other,
      type: "paragraph",
      text: "Is this net or gross?",
    });
    expect(block({ type: "to_do", has_children: true, to_do: { rich_text: runs("Nudge"), checked: false, color: "default" } })).toEqual({
      id: ID.other,
      type: "to_do",
      text: "Nudge",
      checked: false,
      hasChildren: true,
    });
    expect(block({ type: "divider", divider: {} })).toEqual({ id: ID.other, type: "divider" });
  });

  it("retains bookmark and embed destinations for link audits", () => {
    expect(block({ type: "bookmark", bookmark: { url: "https://docs.google.com/spreadsheets/d/test" } })).toMatchObject({ url: "https://docs.google.com/spreadsheets/d/test" });
    expect(block({ type: "embed", embed: { url: "https://example.com" } })).toMatchObject({ url: "https://example.com" });
  });

  it("points a meeting-notes block at its summary, notes and transcript", () => {
    const out = block({
      type: "meeting_notes",
      meeting_notes: {
        title: runs("Meeting"),
        status: "notes_ready",
        children: { summary_block_id: ID.page, notes_block_id: ID.row, transcript_block_id: ID.source },
        recording: { start_time: "2026-09-01T10:00:00.000Z", end_time: null },
        calendar_event: null,
      },
    });
    expect(out).toEqual({
      id: ID.other,
      type: "meeting_notes",
      meetingNotes: {
        title: "Meeting",
        status: "notes_ready",
        summaryBlockId: ID.page,
        notesBlockId: ID.row,
        transcriptBlockId: ID.source,
        recording: { start: "2026-09-01T10:00:00.000Z" },
      },
    });
  });

  it("names a type the API does not support", () => {
    expect(block({ type: "unsupported", unsupported: { block_type: "transcript_segment" } })).toEqual({
      id: ID.other,
      type: "unsupported",
      unsupported: "transcript_segment",
    });
  });
});
